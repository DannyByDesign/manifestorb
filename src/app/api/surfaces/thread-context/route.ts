import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/surfaces/thread-context");
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET;

const requestSchema = z.object({
  provider: z.enum(["slack", "discord", "telegram"]),
  providerAccountId: z.string().min(1),
  channelId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("x-surfaces-secret");
  const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
    if (!SHARED_SECRET) logger.warn("SURFACES_SHARED_SECRET not set!");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { provider, providerAccountId, channelId } = parsed.data;
    const account = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId },
      },
      select: { userId: true },
    });
    if (!account?.userId) {
      return NextResponse.json({ threadId: null });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        userId: account.userId,
        provider,
        channelId,
        threadId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: { threadId: true, updatedAt: true },
    });

    return NextResponse.json({
      threadId: conversation?.threadId ?? null,
      updatedAt: conversation?.updatedAt?.toISOString() ?? null,
    });
  } catch (error) {
    logger.error("Failed to resolve surface thread context", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
