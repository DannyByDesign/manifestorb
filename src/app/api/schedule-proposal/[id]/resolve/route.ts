import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";
import { resolveScheduleProposalRequestById } from "@/features/calendar/schedule-proposal";

const logger = createScopedLogger("schedule-proposal/resolve");

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
  const choiceRaw = Number(body.choice);
  if (!Number.isFinite(choiceRaw)) {
    return NextResponse.json({ error: "Invalid choice" }, { status: 400 });
  }
  const choiceIndex = choiceRaw >= 1 ? choiceRaw - 1 : choiceRaw;

  const result = await resolveScheduleProposalRequestById({
    requestId: id,
    choiceIndex,
    userId: isSurfaces ? undefined : session?.user?.id,
  });

  if (!result.ok) {
    const status =
      result.error === "Forbidden"
        ? 403
        : result.error === "Request not found"
          ? 404
          : result.error === "Request expired"
            ? 410
            : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  logger.info("Resolved schedule proposal", { requestId: id });
  return NextResponse.json({ success: true, data: result.data });
}
