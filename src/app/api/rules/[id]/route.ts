import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { mapRuleActionsForMutation } from "@/features/rules/action-mapper";
import { updateRule } from "@/features/rules/rule";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";

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
      runOnThreads: true,
    });

    return NextResponse.json({ rule });
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
    const emailAccount = await findUserEmailAccountWithProvider({
      userId: session.user.id,
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    await prisma.rule.delete({
      where: { id, emailAccountId: emailAccount.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("Failed to delete rule", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
