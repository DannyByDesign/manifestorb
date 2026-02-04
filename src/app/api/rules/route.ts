import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/lib/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { createRule } from "@/features/rules/rule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const logger = createScopedLogger("api/rules");
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const emailAccount = await prisma.emailAccount.findFirst({
      where: { userId: session.user.id },
      include: { account: true },
      orderBy: { createdAt: "asc" },
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

    const emailAccount = await prisma.emailAccount.findFirst({
      where: { userId: session.user.id },
      include: { account: true },
      orderBy: { createdAt: "asc" },
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
        actions: parsed.data.actions.map((actionItem) => ({
          type: actionItem.type,
          fields: actionItem.fields
            ? {
                content: actionItem.fields.content ?? null,
                to: actionItem.fields.to ?? null,
                subject: actionItem.fields.subject ?? null,
                label: actionItem.fields.label ?? null,
                webhookUrl: actionItem.fields.webhookUrl ?? null,
                cc: actionItem.fields.cc ?? null,
                bcc: actionItem.fields.bcc ?? null,
                payload: actionItem.fields.payload ?? null,
                ...(provider === "microsoft" && {
                  folderName: actionItem.fields.folderName ?? null,
                }),
              }
            : null,
        })),
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
