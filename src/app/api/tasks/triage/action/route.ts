import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import prisma from "@/server/db/client";
import { auth } from "@/server/lib/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { ApprovalService } from "@/features/approvals/service";
import { createInAppNotification } from "@/features/notifications/create";
import { z } from "zod";

const logger = createScopedLogger("api/tasks/triage/action");
const approvalService = new ApprovalService(prisma);

const requestSchema = z.object({
  taskId: z.string().min(1),
  changes: z.record(z.string(), z.any()),
  summary: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { taskId, changes, summary } = parsed.data;
    const requestPayload = {
      actionType: "tool_execution",
      description: summary || "Update task",
      tool: "modify",
      args: {
        resource: "task",
        ids: [taskId],
        changes,
      },
    };

    const idempotencyKey = createHash("sha256")
      .update(`triage-action:${session.user.id}:${taskId}:${JSON.stringify(changes)}`)
      .digest("hex");

    const approval = await approvalService.createRequest({
      userId: session.user.id,
      provider: "web",
      externalContext: { source: "task-triage" },
      requestPayload,
      idempotencyKey,
      expiresInSeconds: 3600,
    } as any);

    await createInAppNotification({
      userId: session.user.id,
      title: "Approval Required",
      body: summary || "Update task",
      type: "approval",
      metadata: {
        approvalId: approval.id,
        tool: "modify",
        args: requestPayload.args,
      },
      dedupeKey: `approval-${approval.id}`,
    });

    return NextResponse.json({ approvalId: approval.id });
  } catch (error) {
    logger.error("Failed to create triage action approval", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
