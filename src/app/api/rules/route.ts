import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { mapRuleActionsForMutation } from "@/features/rules/action-mapper";
import { createRule } from "@/features/rules/rule";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";

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

    const rules = await prisma.rule.findMany({
      where: { emailAccountId: emailAccount.id },
      include: { actions: true, group: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      about: emailAccount.about || "Not set",
      rules,
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
      runOnThreads: true,
      logger,
    });

    return NextResponse.json({ rule });
  } catch (error) {
    logger.error("Failed to create rule", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
