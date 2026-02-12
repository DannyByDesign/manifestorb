import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { withError } from "@/server/lib/middleware";

export const POST = withError("slack/disconnect", async () => {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized", isKnownError: true },
      { status: 401 },
    );
  }

  const result = await prisma.account.deleteMany({
    where: {
      userId: session.user.id,
      provider: "slack",
    },
  });

  return NextResponse.json({
    ok: true,
    deleted: result.count,
  });
});

