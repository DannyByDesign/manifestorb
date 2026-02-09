import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { mapRuleActionsForMutation } from "@/features/rules/action-mapper";
import { updateRule } from "@/features/rules/rule";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import {
  findApprovalRuleById,
  normalizeApprovalOperationKey,
  removeApprovalRule,
  upsertApprovalRule,
} from "@/features/approvals/rules";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const logger = createScopedLogger("api/rules/update");

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    const provider = emailAccount.account?.provider || "google";
    const body = await req.json();
    const type = (body?.type as string | undefined) ?? "email_rule";

    if (type === "approval_rule") {
      const parsed = z
        .object({
          toolName: z.string().optional(),
          name: z.string().optional(),
          policy: z.enum(["always", "never", "conditional"]).optional(),
          resource: z.string().optional(),
          operation: z.string().optional(),
          enabled: z.boolean().optional(),
          disabledUntil: z.string().optional(),
          priority: z.number().int().optional(),
          conditions: z
            .object({
              externalOnly: z.boolean().optional(),
              domains: z.array(z.string()).optional(),
              minItemCount: z.number().int().min(0).optional(),
              maxItemCount: z.number().int().min(0).optional(),
            })
            .optional(),
        })
        .safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid payload", details: parsed.error.issues },
          { status: 400 },
        );
      }

      const resolvedToolName =
        parsed.data.toolName ??
        (await findApprovalRuleById({ userId: session.user.id, ruleId: id }))?.toolName;
      if (!resolvedToolName) {
        return NextResponse.json({ error: "Approval rule not found" }, { status: 404 });
      }

      const existing = await findApprovalRuleById({ userId: session.user.id, ruleId: id });
      if (!existing) {
        return NextResponse.json({ error: "Approval rule not found" }, { status: 404 });
      }

      const rule = await upsertApprovalRule({
        userId: session.user.id,
        toolName: resolvedToolName,
        rule: {
          id,
          name: parsed.data.name ?? existing.rule.name,
          policy: parsed.data.policy ?? existing.rule.policy,
          resource: parsed.data.resource ?? existing.rule.resource,
          operation: normalizeApprovalOperationKey(parsed.data.operation) ?? existing.rule.operation,
          enabled: parsed.data.enabled ?? existing.rule.enabled,
          disabledUntil: parsed.data.disabledUntil ?? existing.rule.disabledUntil,
          priority: parsed.data.priority ?? existing.rule.priority,
          conditions: parsed.data.conditions ?? existing.rule.conditions,
        },
      });

      return NextResponse.json({ type: "approval_rule", rule });
    }

    const parsed = createRuleSchema(provider).safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const rule = await updateRule({
      ruleId: id,
      result: {
        name: parsed.data.name,
        ruleId: id,
        condition: parsed.data.condition,
        actions: mapRuleActionsForMutation({
          actions: parsed.data.actions,
          provider,
        }),
      },
      emailAccountId: emailAccount.id,
      provider,
      logger,
      runOnThreads: body?.runOnThreads ?? true,
    });

    return NextResponse.json({ type: "email_rule", rule });
  } catch (error) {
    logger.error("Failed to update rule", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const logger = createScopedLogger("api/rules/delete");

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await req.json().catch(() => ({}));
    const type = (body?.type as string | undefined) ?? "email_rule";

    if (type === "approval_rule") {
      const toolName =
        (body?.toolName as string | undefined) ??
        (await findApprovalRuleById({ userId: session.user.id, ruleId: id }))?.toolName;
      if (!toolName) {
        return NextResponse.json({ error: "Approval rule not found" }, { status: 404 });
      }

      const removed = await removeApprovalRule({
        userId: session.user.id,
        toolName,
        ruleId: id,
      });
      if (!removed.removed) {
        return NextResponse.json({ error: "Approval rule not found" }, { status: 404 });
      }
      return NextResponse.json({ success: true, type: "approval_rule" });
    }

    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    await prisma.rule.delete({
      where: { id, emailAccountId: emailAccount.id },
    });

    return NextResponse.json({ success: true, type: "email_rule" });
  } catch (error) {
    logger.error("Failed to delete rule", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
