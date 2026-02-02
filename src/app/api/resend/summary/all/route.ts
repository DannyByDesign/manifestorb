import { NextResponse } from "next/server";
import { subDays } from "date-fns/subDays";
import prisma from "@/server/db/client";
import { withError } from "@/server/lib/middleware";
import { getInternalApiUrl } from "@/server/lib/internal-api";
import {
  getCronSecretHeader,
  hasCronSecret,
  hasPostCronSecret,
} from "@/server/lib/cron";
import { Frequency } from "@/generated/prisma/enums";
import { captureException } from "@/server/lib/error";
import type { Logger } from "@/server/lib/logger";
import { publishToQstashQueue } from "@/server/lib/upstash";
import { getPremiumUserFilter } from "@/features/premium";
import type { SendSummaryEmailBody } from "../validation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withError("cron/resend/summary/all", async (request) => {
  if (!hasCronSecret(request)) {
    captureException(new Error("Unauthorized request: api/resend/summary/all"));
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await sendSummaryAllUpdate(request.logger);

  return NextResponse.json(result);
});

export const POST = withError("cron/resend/summary/all", async (request) => {
  if (!(await hasPostCronSecret(request))) {
    captureException(
      new Error("Unauthorized cron request: api/resend/summary/all"),
    );
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await sendSummaryAllUpdate(request.logger);

  return NextResponse.json(result);
});

async function sendSummaryAllUpdate(logger: Logger) {
  logger.info("Sending summary all update");

  const emailAccounts = await prisma.emailAccount.findMany({
    select: { id: true },
    where: {
      summaryEmailFrequency: {
        not: Frequency.NEVER,
      },
      ...getPremiumUserFilter(),
      // User at least 4 days old
      createdAt: {
        lt: subDays(new Date(), 4),
      },
    },
  });

  logger.info("Sending summary to users", { count: emailAccounts.length });

  const url = `${getInternalApiUrl()}/api/resend/summary`;

  for (const emailAccount of emailAccounts) {
    try {
      await publishToQstashQueue<SendSummaryEmailBody>({
        queueName: "email-summary-all",
        parallelism: 3, // Allow up to 3 concurrent jobs from this queue
        url,
        body: { emailAccountId: emailAccount.id },
        headers: getCronSecretHeader(),
      });
    } catch (error) {
      logger.error("Failed to publish to Qstash", {
        emailAccountId: emailAccount.id,
        error,
      });
    }
  }

  logger.info("All requests initiated", { count: emailAccounts.length });
  return { count: emailAccounts.length };
}
