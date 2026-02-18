import { NextRequest, NextResponse } from "next/server";
import { createLinkToken } from "@/server/lib/linking";
import { createScopedLogger } from "@/server/lib/logger";
import { z } from "zod";
import { env } from "@/env";

const logger = createScopedLogger("api/surfaces/link-token");

const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const bodySchema = z.object({
  provider: z.enum(["slack", "discord", "telegram"]),
  providerAccountId: z.string().min(1),
  providerTeamId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Surfaces-worker-only: get a link URL for proactive onboarding.
 * Called by the worker when a user opens a DM (im_open) or when sending a welcome to a user.
 */
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
      return NextResponse.json(
        { error: "Invalid body", details: parse.error.issues },
        { status: 400 },
      );
    }

    const { provider, providerAccountId: rawProviderAccountId, providerTeamId, metadata } = parse.data;
    const providerAccountId =
      provider === "slack" && providerTeamId && !rawProviderAccountId.includes(":")
        ? `${providerTeamId}:${rawProviderAccountId}`
        : rawProviderAccountId;
    const rawToken = await createLinkToken({
      provider,
      providerAccountId,
      providerTeamId,
      metadata: metadata ?? {},
    });

    const baseUrl = env.NEXT_PUBLIC_BASE_URL;
    const linkUrl = `${baseUrl}/link?token=${rawToken}`;

    logger.info("Link token created for surfaces worker onboarding", {
      provider,
      providerAccountId: providerAccountId.slice(0, 8) + "...",
    });

    return NextResponse.json({ linkUrl });
  } catch (err) {
    logger.error("Error creating link token", { error: err });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
