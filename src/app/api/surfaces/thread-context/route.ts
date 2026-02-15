import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";

const logger = createScopedLogger("api/surfaces/thread-context");
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const requestSchema = z.object({
  provider: z.enum(["slack", "discord", "telegram"]),
  providerAccountId: z.string().min(1),
  providerTeamId: z.string().optional(),
  channelId: z.string().min(1),
});

function normalizeSlackAccountCandidates(input: {
  providerAccountId: string;
  providerTeamId?: string;
}): string[] {
  const raw = input.providerAccountId.trim();
  const team = input.providerTeamId?.trim();
  const candidates: string[] = [];

  if (team && !raw.includes(":")) {
    candidates.push(`${team}:${raw}`, raw);
    return candidates;
  }

  candidates.push(raw);
  if (raw.includes(":")) {
    const legacy = raw.split(":").pop();
    if (legacy) candidates.push(legacy);
  }
  return candidates;
}

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

    const { provider, providerAccountId, providerTeamId, channelId } = parsed.data;
    const accountIdCandidates =
      provider === "slack"
        ? normalizeSlackAccountCandidates({
            providerAccountId,
            providerTeamId,
          })
        : [providerAccountId.trim()];

    let accountUserId: string | null = null;
    for (const candidate of accountIdCandidates) {
      const account = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: { provider, providerAccountId: candidate },
        },
        select: { userId: true },
      });
      if (account?.userId) {
        accountUserId = account.userId;
        break;
      }
    }

    if (!accountUserId && provider === "slack" && !providerAccountId.includes(":")) {
      const suffixMatchesRaw = await prisma.account.findMany({
        where: {
          provider: "slack",
          providerAccountId: {
            endsWith: `:${providerAccountId.trim()}`,
          },
        },
        select: { userId: true },
        take: 2,
      });
      const suffixMatches = Array.isArray(suffixMatchesRaw) ? suffixMatchesRaw : [];
      if (suffixMatches.length === 1) {
        accountUserId = suffixMatches[0].userId;
      }
    }

    if (!accountUserId) {
      return NextResponse.json({ threadId: null });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        userId: accountUserId,
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
