import { NextResponse } from "next/server";
import { env } from "@/env";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { createEmailProvider } from "@/features/email/provider";
import { sendDraftById } from "@/features/drafts/operations";

const logger = createScopedLogger("jobs/scheduled-draft-sends");
const ORPHAN_PENDING_GRACE_MS = 5 * 60 * 1_000;

export const maxDuration = 300;

function hasValidAuth(request: Request): boolean {
  const authHeader = request.headers.get("Authorization");
  const validCron = env.CRON_SECRET && authHeader === `Bearer ${env.CRON_SECRET}`;
  const validJob = env.JOBS_SHARED_SECRET && authHeader === `Bearer ${env.JOBS_SHARED_SECRET}`;
  return Boolean(validCron || validJob);
}

async function loadSnapshot() {
  const [pendingCount, nextPending] = await Promise.all([
    prisma.scheduledDraftSend.count({ where: { status: "PENDING" } }),
    prisma.scheduledDraftSend.findFirst({
      where: { status: "PENDING" },
      orderBy: { sendAt: "asc" },
      select: { id: true, sendAt: true, emailAccountId: true },
    }),
  ]);
  return { pendingCount, nextPending };
}

export async function GET(request: Request) {
  if (!hasValidAuth(request)) {
    logger.warn("Unauthorized request to read scheduled-draft-sends health");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const snapshot = await loadSnapshot();
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    logger.error("Scheduled draft send health read failed", { error });
    return NextResponse.json(
      { success: false, error: "scheduled_draft_send_health_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!hasValidAuth(request)) {
    logger.warn("Unauthorized request to process scheduled-draft-sends");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      maxJobs?: number;
      dryRun?: boolean;
      includeFailed?: boolean;
    };

    const maxJobs =
      typeof body.maxJobs === "number" && Number.isFinite(body.maxJobs)
        ? Math.max(1, Math.min(500, Math.trunc(body.maxJobs)))
        : 50;
    const dryRun = body.dryRun === true;
    const includeFailed = body.includeFailed === true;

    const now = new Date();

    const orphanCutoff = new Date(now.getTime() - ORPHAN_PENDING_GRACE_MS);
    const orphanedPendingWhere = {
      status: "PENDING" as const,
      scheduledId: null,
      sendAt: { lte: orphanCutoff },
    };
    const orphanedPendingCount = await prisma.scheduledDraftSend.count({
      where: orphanedPendingWhere,
    });
    let reconciledOrphans = 0;
    if (!dryRun && orphanedPendingCount > 0) {
      const reconciled = await prisma.scheduledDraftSend.updateMany({
        where: orphanedPendingWhere,
        data: {
          status: "FAILED",
          lastError:
            "Scheduled send queue publish was not confirmed before execution deadline.",
        },
      });
      reconciledOrphans = reconciled.count;
      if (reconciled.count > 0) {
        logger.warn("Reconciled orphaned scheduled draft sends", {
          orphanedPendingCount,
          reconciled: reconciled.count,
          orphanCutoff: orphanCutoff.toISOString(),
        });
      }
    }

    const due = await prisma.scheduledDraftSend.findMany({
      where: {
        status: includeFailed
          ? { in: ["PENDING", "FAILED"] }
          : "PENDING",
        sendAt: { lte: now },
      },
      orderBy: { sendAt: "asc" },
      take: maxJobs,
    });

    if (dryRun) {
      const snapshot = await loadSnapshot();
      return NextResponse.json({
        success: true,
        dryRun: true,
        dueCount: due.length,
        due: due.map((row) => ({
          id: row.id,
          emailAccountId: row.emailAccountId,
          draftId: row.draftId,
          sendAt: row.sendAt,
          status: row.status,
        })),
        orphanedPendingCount,
        ...snapshot,
      });
    }

    let attempted = 0;
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const row of due) {
      attempted += 1;

      // Acquire the row for sending (best-effort concurrency control).
      const lock = await prisma.scheduledDraftSend.updateMany({
        where: { id: row.id, status: row.status },
        data: { status: "SENDING" },
      });
      if (lock.count === 0) {
        skipped += 1;
        continue;
      }

      const log = logger.with({
        scheduledDraftSendId: row.id,
        emailAccountId: row.emailAccountId,
        draftId: row.draftId,
      });

      try {
        const emailAccount = await prisma.emailAccount.findUnique({
          where: { id: row.emailAccountId },
          include: { account: { select: { provider: true } } },
        });

        if (!emailAccount?.account?.provider) {
          throw new Error("EMAIL_ACCOUNT_NOT_FOUND");
        }

        const provider = await createEmailProvider({
          emailAccountId: emailAccount.id,
          provider: emailAccount.account.provider,
          logger: log,
        });

        const result = await sendDraftById({
          provider,
          draftId: row.draftId,
          requireExisting: true,
        });

        await prisma.scheduledDraftSend.update({
          where: { id: row.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            messageId: result.messageId,
            threadId: result.threadId,
            lastError: null,
          },
        });

        sent += 1;
        log.info("Scheduled draft sent", {
          messageId: result.messageId,
          threadId: result.threadId,
        });
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Scheduled draft send failed", {
          scheduledDraftSendId: row.id,
          error: message,
        });

        await prisma.scheduledDraftSend.update({
          where: { id: row.id },
          data: {
            status: "FAILED",
            lastError: message,
          },
        });
      }
    }

    const snapshot = await loadSnapshot();

    return NextResponse.json({
      success: true,
      attempted,
      sent,
      failed,
      skipped,
      reconciledOrphans,
      ...snapshot,
    });
  } catch (error) {
    logger.error("Scheduled draft send processing failed", { error });
    return NextResponse.json(
      { success: false, error: "scheduled_draft_send_processing_failed" },
      { status: 500 },
    );
  }
}
