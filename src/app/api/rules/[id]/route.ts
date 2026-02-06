import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { createRuleSchema } from "@/features/rules/ai/prompts/create-rule-schema";
import { updateRule } from "@/features/rules/rule";

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

    const rule = await updateRule({
      ruleId: id,
      result: {
        name: parsed.data.name,
        ruleId: id,
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
    const emailAccount = await prisma.emailAccount.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
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
