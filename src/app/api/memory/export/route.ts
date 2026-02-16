import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { logMemoryAccessAudit } from "@/server/features/memory/structured/service";

interface RelationshipExportRow {
  id: string;
  personId: string;
  relatedPersonId: string | null;
  relationType: string;
  assertion: string;
  status: string;
  confidence: number;
  updatedAt: Date;
}

interface CommitmentExportRow {
  id: string;
  personId: string | null;
  description: string;
  owner: string;
  status: string;
  dueAt: Date | null;
  confidence: number;
  updatedAt: Date;
}

interface EpisodeExportRow {
  id: string;
  title: string | null;
  summary: string | null;
  sourceConversationId: string | null;
  sourceEmailThreadId: string | null;
  createdAt: Date;
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const [facts, relationships, commitments, episodes] = await Promise.all([
    prisma.memoryFact.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.$queryRaw<RelationshipExportRow[]>`
      SELECT "id", "personId", "relatedPersonId", "relationType", "assertion", "status", "confidence", "updatedAt"
      FROM "RelationshipAssertion"
      WHERE "userId" = ${userId}
      ORDER BY "updatedAt" DESC
      LIMIT 500
    `,
    prisma.$queryRaw<CommitmentExportRow[]>`
      SELECT "id", "personId", "description", "owner", "status", "dueAt", "confidence", "updatedAt"
      FROM "CommitmentMemory"
      WHERE "userId" = ${userId}
      ORDER BY "updatedAt" DESC
      LIMIT 500
    `,
    prisma.$queryRaw<EpisodeExportRow[]>`
      SELECT "id", "title", "summary", "sourceConversationId", "sourceEmailThreadId", "createdAt"
      FROM "InteractionEpisode"
      WHERE "userId" = ${userId}
      ORDER BY "createdAt" DESC
      LIMIT 500
    `,
  ]);

  await logMemoryAccessAudit({
    userId,
    accessType: "memory_export",
    resultCount: facts.length + relationships.length + commitments.length + episodes.length,
    surface: "web",
  });

  return NextResponse.json({
    userId,
    exportedAt: new Date().toISOString(),
    facts,
    relationships,
    commitments,
    episodes,
  });
}
