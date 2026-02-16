import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { z } from "zod";
import { orchestrateMemoryRetrieval } from "@/server/features/memory/retrieval/orchestrator";

const querySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q"),
    limit: url.searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", details: parsed.error.issues }, { status: 400 });
  }

  const result = await orchestrateMemoryRetrieval({
    userId,
    query: parsed.data.q,
    limit: parsed.data.limit,
    surface: "web",
  });

  return NextResponse.json({
    success: true,
    ...result,
  });
}
