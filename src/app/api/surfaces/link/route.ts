import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { consumeLinkToken } from "@/server/utils/linking";
import { createScopedLogger } from "@/server/utils/logger";

const logger = createScopedLogger("API/Surfaces/Link");

export async function POST(req: NextRequest) {
    try {
        const session = await auth();

        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized. Please log in first." }, { status: 401 });
        }

        const body = await req.json();
        const { token } = body;

        if (!token || typeof token !== "string") {
            return NextResponse.json({ error: "Missing or invalid token" }, { status: 400 });
        }

        const result = await consumeLinkToken(token, session.user.id);

        logger.info("Account linked successfully via API", {
            userId: session.user.id,
            provider: result.provider
        });

        return NextResponse.json({ success: true, provider: result.provider });

    } catch (error: unknown) {
        logger.error("Error linking account", { error });
        const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
