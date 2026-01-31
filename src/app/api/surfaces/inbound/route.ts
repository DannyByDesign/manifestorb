
import { NextRequest, NextResponse } from "next/server";
import { ChannelRouter } from "@/server/channels/router";
import { InboundMessage } from "@/server/channels/types";
import { env } from "@/env";

// Ensure this environment variable is defined in your schema
const SHARED_SECRET = process.env.SURFACES_SHARED_SECRET;

export async function POST(req: NextRequest) {
    // 1. Auth Check
    const authHeader = req.headers.get("x-surfaces-secret");
    const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");

    if (!SHARED_SECRET || (authHeader !== SHARED_SECRET && authBearer !== SHARED_SECRET)) {
        if (!SHARED_SECRET) console.warn("SURFACES_SHARED_SECRET not set!");
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await req.json();
        const message = body as InboundMessage;

        // 2. Route Message
        const router = new ChannelRouter();
        const responses = await router.handleInbound(message);

        // 3. Return Outbound Messages
        return NextResponse.json({ responses });
    } catch (err) {
        console.error("Error in surfaces/inbound:", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Internal Server Error" },
            { status: 500 }
        );
    }
}
