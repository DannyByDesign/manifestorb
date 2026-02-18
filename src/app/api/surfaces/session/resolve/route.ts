import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/client";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { deriveCanonicalThreadId } from "@/features/channels/conversation-key";
import { resolveSurfaceAccount } from "@/features/channels/surface-account";

const logger = createScopedLogger("api/surfaces/session/resolve");
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const bodySchema = z.object({
  provider: z.enum(["slack", "discord", "telegram", "web"]),
  providerAccountId: z.string().min(1),
  providerTeamId: z.string().optional(),
  channelId: z.string().min(1),
  isDirectMessage: z.boolean().optional(),
  incomingThreadId: z.string().optional(),
  messageId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("x-surfaces-secret");
  const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const {
      provider,
      providerAccountId,
      providerTeamId,
      channelId,
      isDirectMessage,
      incomingThreadId,
      messageId,
    } = parsed.data;

    const accountResolution = await resolveSurfaceAccount({
      provider,
      providerAccountId,
      workspaceId: providerTeamId,
    });

    let canonicalThreadId = deriveCanonicalThreadId({
      provider,
      isDirectMessage,
      incomingThreadId,
      messageId,
    });

    if (!accountResolution.userId) {
      return NextResponse.json({
        status: accountResolution.resolutionStatus,
        linked: false,
        canonicalThreadId,
        ...(accountResolution.reason ? { reason: accountResolution.reason } : {}),
      });
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        userId: accountResolution.userId,
        provider,
        channelId,
        threadId: canonicalThreadId,
      },
      select: {
        id: true,
        channelId: true,
        threadId: true,
      },
    });

    // Recover latest canonical thread when a platform omits thread id.
    if (!conversation && !incomingThreadId) {
      const latestConversation = await prisma.conversation.findFirst({
        where: {
          userId: accountResolution.userId,
          provider,
          channelId,
          threadId: { not: null },
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
          channelId: true,
          threadId: true,
        },
      });
      if (latestConversation?.threadId) {
        canonicalThreadId = latestConversation.threadId;
        conversation = latestConversation;
      }
    }

    return NextResponse.json({
      status: "linked",
      linked: true,
      userId: accountResolution.userId,
      matchedProviderAccountId: accountResolution.matchedProviderAccountId,
      canonicalThreadId,
      conversationId: conversation?.id ?? null,
      canonicalChannelId: conversation?.channelId ?? channelId,
    });
  } catch (error) {
    logger.error("Failed to resolve surfaces session", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
