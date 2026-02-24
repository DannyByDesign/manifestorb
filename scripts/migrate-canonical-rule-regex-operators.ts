import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

type ConditionRecord = {
  field?: unknown;
  op?: unknown;
  value?: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function migrateMatch(match: unknown): { match: Record<string, unknown>; changed: boolean } {
  const normalized = asObject(match);
  const conditions = Array.isArray(normalized.conditions) ? normalized.conditions : [];
  let changed = false;
  const migrated = conditions.map((entry) => {
    const condition = asObject(entry) as ConditionRecord;
    if (condition.op !== "regex") return condition as Record<string, unknown>;
    changed = true;
    return {
      ...condition,
      op: "contains",
    };
  });

  if (!changed) return { match: normalized, changed: false };
  return {
    match: {
      ...normalized,
      conditions: migrated,
    },
    changed: true,
  };
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const rules = await prisma.canonicalRule.findMany({
    select: {
      id: true,
      version: true,
      match: true,
      sourceMode: true,
      compilerWarnings: true,
    },
  });

  let touched = 0;
  for (const rule of rules) {
    const migrated = migrateMatch(rule.match);
    if (!migrated.changed) continue;
    touched += 1;
    if (dryRun) continue;

    const warnings = Array.isArray(rule.compilerWarnings)
      ? rule.compilerWarnings.map(String)
      : [];
    warnings.push("regex operator migrated to contains");

    const nextVersion = rule.version + 1;
    const updated = await prisma.canonicalRule.update({
      where: { id: rule.id },
      data: {
        version: nextVersion,
        match: migrated.match as Prisma.InputJsonValue,
        compilerWarnings: warnings as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.canonicalRuleVersion.create({
      data: {
        canonicalRuleId: updated.id,
        version: updated.version,
        payload: {
          id: updated.id,
          version: updated.version,
          match: migrated.match,
        } as Prisma.InputJsonValue,
        sourceMode: updated.sourceMode,
      },
    });
  }

  const mode = dryRun ? "dry-run" : "apply";
  console.log(`[${mode}] migrated ${touched} canonical rules from regex -> contains`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
