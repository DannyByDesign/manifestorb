import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import prisma from "@/server/db/client";
import { logMemoryAccessAudit } from "@/server/features/memory/structured/service";

const forgetSchema = z.object({
  scope: z.enum(["all", "key", "person"]),
  key: z.string().optional(),
  personName: z.string().optional(),
});

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = forgetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.issues }, { status: 400 });
  }

  const { scope, key, personName } = parsed.data;

  if (scope === "all") {
    const [facts, relationships, commitments] = await Promise.all([
      prisma.memoryFact.updateMany({
        where: { userId },
        data: { isActive: false, updatedAt: new Date() },
      }),
      prisma.$executeRaw`
        UPDATE "RelationshipAssertion"
        SET "status" = 'SUPERSEDED', "updatedAt" = NOW()
        WHERE "userId" = ${userId}
      `,
      prisma.$executeRaw`
        UPDATE "CommitmentMemory"
        SET "status" = 'CANCELLED', "updatedAt" = NOW(), "resolvedAt" = NOW()
        WHERE "userId" = ${userId}
          AND "status" = 'OPEN'
      `,
    ]);

    await logMemoryAccessAudit({
      userId,
      accessType: "memory_forget_all",
      resultCount: Number(facts.count) + Number(relationships) + Number(commitments),
      surface: "web",
    });

    return NextResponse.json({
      success: true,
      scope,
      updated: {
        facts: facts.count,
        relationships: Number(relationships),
        commitments: Number(commitments),
      },
    });
  }

  if (scope === "key") {
    if (!key || !key.trim()) {
      return NextResponse.json({ error: "key is required for scope=key" }, { status: 400 });
    }

    const result = await prisma.memoryFact.updateMany({
      where: {
        userId,
        OR: [{ key: key.trim() }, { key: key.trim().toLowerCase() }],
      },
      data: { isActive: false, updatedAt: new Date() },
    });

    await logMemoryAccessAudit({
      userId,
      accessType: "memory_forget_key",
      query: key,
      resultCount: result.count,
      surface: "web",
    });

    return NextResponse.json({ success: true, scope, updated: result.count });
  }

  if (!personName || !personName.trim()) {
    return NextResponse.json({ error: "personName is required for scope=person" }, { status: 400 });
  }

  const normalizedName = normalizeName(personName);
  const personRows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "PersonMemory"
    WHERE "userId" = ${userId}
      AND "normalizedName" = ${normalizedName}
    LIMIT 1
  `;
  const personId = personRows[0]?.id;
  if (!personId) {
    return NextResponse.json({ success: true, scope, updated: { relationships: 0, commitments: 0 } });
  }

  const [relationships, commitments] = await Promise.all([
    prisma.$executeRaw`
      UPDATE "RelationshipAssertion"
      SET "status" = 'SUPERSEDED', "updatedAt" = NOW()
      WHERE "userId" = ${userId}
        AND ("personId" = ${personId} OR "relatedPersonId" = ${personId})
    `,
    prisma.$executeRaw`
      UPDATE "CommitmentMemory"
      SET "status" = 'CANCELLED', "updatedAt" = NOW(), "resolvedAt" = NOW()
      WHERE "userId" = ${userId}
        AND "personId" = ${personId}
        AND "status" = 'OPEN'
    `,
  ]);

  await logMemoryAccessAudit({
    userId,
    accessType: "memory_forget_person",
    query: personName,
    resultCount: Number(relationships) + Number(commitments),
    surface: "web",
  });

  return NextResponse.json({
    success: true,
    scope,
    updated: {
      relationships: Number(relationships),
      commitments: Number(commitments),
    },
  });
}
