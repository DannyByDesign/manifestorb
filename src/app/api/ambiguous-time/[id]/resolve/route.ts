import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { resolveAmbiguousTimeRequestById } from "@/features/calendar/ambiguous-time";

const logger = createScopedLogger("ambiguous-time/resolve");

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const session = await auth();
  const surfacesSecret = request.headers.get("x-surfaces-secret");
  const isSurfaces = surfacesSecret && surfacesSecret === env.SURFACES_SHARED_SECRET;

  if (!session?.user?.id && !isSurfaces) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const choice = body.choice as "earlier" | "later";
  if (choice !== "earlier" && choice !== "later") {
    return NextResponse.json({ error: "Invalid choice" }, { status: 400 });
  }

  const result = await resolveAmbiguousTimeRequestById({
    requestId: id,
    choice,
    userId: isSurfaces ? undefined : session?.user?.id,
  });

  if (!result.ok) {
    const status = result.error === "Forbidden" ? 403 : result.error === "Request not found" ? 404 : result.error === "Request expired" ? 410 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ success: true, data: result.data });
}
