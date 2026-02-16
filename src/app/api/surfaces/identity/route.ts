import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { resolveSurfaceAccount } from "@/features/channels/surface-account";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/surfaces/identity");

const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const bodySchema = z.object({
  provider: z.enum(["slack", "discord", "telegram"]),
  providerAccountId: z.string().min(1),
  providerTeamId: z.string().optional(),
});

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

    const { provider, providerAccountId, providerTeamId } = parse.data;
    const resolution = await resolveSurfaceAccount({
      provider,
      providerAccountId,
      workspaceId: providerTeamId,
    });

    if (resolution.userId && resolution.matchedProviderAccountId) {
      return NextResponse.json({
        status: "linked",
        linked: true,
        userId: resolution.userId,
        matchedProviderAccountId: resolution.matchedProviderAccountId,
      });
    }

    if (resolution.resolutionStatus === "unknown") {
      return NextResponse.json({
        linked: false,
        status: "unknown",
        ...(resolution.reason ? { reason: resolution.reason } : {}),
      });
    }

    return NextResponse.json({ status: "unlinked", linked: false });
  } catch (error) {
    logger.error("Failed to resolve surface identity", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
