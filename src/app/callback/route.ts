import { handleAuth } from "@/server/auth";
import { NextResponse, type NextRequest } from "next/server";
import { createScopedLogger } from "@/server/lib/logger";
import { env } from "@/env";

// In container/proxy environments, request host resolution can be internal.
// Force canonical app origin for post-auth redirects.
const handler = handleAuth({ baseURL: env.NEXT_PUBLIC_BASE_URL });
const logger = createScopedLogger("auth/callback");

export const GET = async (request: NextRequest) => {
  try {
    return await handler(request);
  } catch (error) {
    logger.error("AuthKit callback failed", {
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      { error: "Auth callback failed" },
      { status: 500 },
    );
  }
};
