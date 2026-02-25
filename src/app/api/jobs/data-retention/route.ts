import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { applyOperationalRetentionPolicies } from "@/server/features/data-retention/service";

const requestSchema = z.object({
  userId: z.string().optional(),
});

export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${env.JOBS_SHARED_SECRET}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await applyOperationalRetentionPolicies({
    userId: parsed.data.userId,
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
}
