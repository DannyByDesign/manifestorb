import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { scanForAttentionItems } from "@/server/features/ai/proactive/scanner";

export const dynamic = "force-dynamic";

/**
 * GET /api/context/attention
 * Returns items requiring the user's attention (for web UI on load).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items = await scanForAttentionItems(session.user.id);
  return NextResponse.json({ items });
}
