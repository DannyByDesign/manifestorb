import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { getTaskReadinessReport } from "@/features/tasks/triage/audit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const logger = createScopedLogger("api/tasks/triage/audit");

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const report = await getTaskReadinessReport(session.user.id);
    return NextResponse.json({ report });
  } catch (error) {
    logger.error("Failed to build task readiness report", { error });
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
