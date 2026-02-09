import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { mapRuleActionsForMutation } from "@/features/rules/action-mapper";
import { createRule } from "@/features/rules/rule";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import {
  getApprovalOperationLabel,
  normalizeApprovalOperationKey,
  upsertApprovalRule,
} from "@/features/approvals/rules";
import { resumePausedEmailRules } from "@/features/rules/management";
import { z } from "zod";
import { listAssistantPolicies } from "@/features/policies/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const logger = createScopedLogger("api/rules");
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    await resumePausedEmailRules(emailAccount.id);
    const policies = await listAssistantPolicies({
      userId: session.user.id,
      emailAccountId: emailAccount.id,
    });
    const approvalRules = policies.approvalRules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      toolName: rule.toolName,
      operation: rule.operation,
      operationLabel: getApprovalOperationLabel(rule.operation ?? "unknown"),
      policy: rule.policy,
      enabled: rule.enabled ?? true,
      pausedUntil: rule.disabledUntil,
      conditions: rule.conditions,
      priority: rule.priority ?? 0,
    }));

    return NextResponse.json({
      about: emailAccount.about || "Not set",
      preferences: policies.preferences,
      rules: policies.emailRules,
      emailRules: policies.emailRules,
      approvalRules,
      summary: {
        totalEmailRules: policies.emailRules.length,
        totalApprovalRules: approvalRules.length,
      },
    });
  } catch (error) {
    logger.error("Failed to list rules", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const logger = createScopedLogger("api/rules");
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

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
          toolName: z.string().min(1),
          ruleId: z.string().optional(),
          name: z.string().optional(),
          policy: z.enum(["always", "never", "conditional"]),
          resource: z.string().optional(),
          operation: z.string().optional(),
          enabled: z.boolean().optional(),
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
      const rule = await upsertApprovalRule({
        userId: session.user.id,
        toolName: parsed.data.toolName,
        rule: {
          id: parsed.data.ruleId,
          name: parsed.data.name,
          policy: parsed.data.policy,
          resource: parsed.data.resource,
          operation: normalizeApprovalOperationKey(parsed.data.operation),
          enabled: parsed.data.enabled,
          priority: parsed.data.priority,
          conditions: parsed.data.conditions,
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

    const rule = await createRule({
      result: {
        name: parsed.data.name,
        ruleId: undefined,
        condition: parsed.data.condition,
        actions: mapRuleActionsForMutation({
          actions: parsed.data.actions,
          provider,
        }),
      },
      emailAccountId: emailAccount.id,
      provider,
      runOnThreads: body?.runOnThreads ?? true,
      logger,
    });

    return NextResponse.json({ type: "email_rule", rule });
  } catch (error) {
    logger.error("Failed to create rule", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
