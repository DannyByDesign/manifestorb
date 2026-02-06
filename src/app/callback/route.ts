import { handleAuth } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { createScopedLogger } from "@/server/lib/logger";

const handler = handleAuth();
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
