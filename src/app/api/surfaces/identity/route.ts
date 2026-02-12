import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/surfaces/identity");

const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const bodySchema = z.object({
  provider: z.enum(["slack", "discord", "telegram"]),
  providerAccountId: z.string().min(1),
  providerTeamId: z.string().optional(),
});

function normalizeSlackAccountId(input: {
  providerAccountId: string;
  providerTeamId?: string;
}): { primary: string; fallbacks: string[] } {
  const raw = input.providerAccountId.trim();
  const team = input.providerTeamId?.trim();
  const fallbacks: string[] = [];

  // Preferred: "T123:U456" (avoids collisions across workspaces).
  if (team && !raw.includes(":")) {
    return { primary: `${team}:${raw}`, fallbacks: [raw] };
  }

  // If caller already sent composite, accept it but also allow legacy "U456".
  if (raw.includes(":")) {
    const parts = raw.split(":");
    const legacy = parts.length >= 2 ? parts[parts.length - 1] : null;
    if (legacy) fallbacks.push(legacy);
  }

  return { primary: raw, fallbacks };
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("x-surfaces-secret");
  const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");

  if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parse = bodySchema.safeParse(body);
    if (!parse.success) {
      return NextResponse.json({ error: "Invalid body", details: parse.error.issues }, { status: 400 });
    }

    const { provider } = parse.data;
    const providerAccountIdRaw = parse.data.providerAccountId;
    const providerTeamId = parse.data.providerTeamId;

    const candidates =
      provider === "slack"
        ? (() => {
            const normalized = normalizeSlackAccountId({
              providerAccountId: providerAccountIdRaw,
              providerTeamId,
            });
            return [normalized.primary, ...normalized.fallbacks];
          })()
        : [providerAccountIdRaw.trim()];

    for (const providerAccountId of candidates) {
      const account = await prisma.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider,
            providerAccountId,
          },
        },
        select: { userId: true },
      });

      if (account?.userId) {
        return NextResponse.json({
          linked: true,
          userId: account.userId,
        });
      }
    }

    return NextResponse.json({ linked: false });
  } catch (error) {
    logger.error("Failed to resolve surface identity", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

