import { type NextRequest, NextResponse } from "next/server";
import prisma from "@/server/db/client";
import { auth } from "@/server/lib/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { triageTasks } from "@/features/tasks/triage/TaskTriageService";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const logger = createScopedLogger("api/tasks/triage");

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const emailAccount = await prisma.emailAccount.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!emailAccount) {
      return NextResponse.json({ error: "No email account linked" }, { status: 400 });
    }

    const message = req.nextUrl.searchParams.get("message") ?? undefined;
    const result = await triageTasks({
      userId: session.user.id,
      emailAccountId: emailAccount.id,
      logger,
      messageContent: message,
    });

    return NextResponse.json({ data: result });
  } catch (error) {
    logger.error("Failed to run task triage", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
