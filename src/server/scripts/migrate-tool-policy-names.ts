import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

const TOOL_NAME_MAPPINGS: Readonly<Record<string, string>> = {
  "email.getUnreadCount": "email.countUnread",
  "email.searchThreads": "email.search",
  "email.searchThreadsAdvanced": "email.search",
  "email.searchSent": "email.search",
  "email.searchInbox": "email.search",
};

function mapToolName(value: string): string {
  return TOOL_NAME_MAPPINGS[value] ?? value;
}

function mapStringList(values: string[] | null | undefined): string[] {
  if (!Array.isArray(values)) return [];
  const mapped = values
    .map((value) => mapToolName(value))
    .filter((value) => value.trim().length > 0);
  return Array.from(new Set(mapped));
}

function migrateJson(value: unknown): unknown {
  if (typeof value === "string") {
    return mapToolName(value);
  }
  if (Array.isArray(value)) {
    const mapped = value.map((entry) => migrateJson(entry));
    if (mapped.every((entry) => typeof entry === "string")) {
      return Array.from(new Set(mapped as string[]));
    }
    return mapped;
  }
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    out[key] = migrateJson(entry);
  }
  return out;
}

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function toPrismaNullableJson(
  value: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await prisma.userAIConfig.findMany({
    select: {
      id: true,
      userId: true,
      toolAllow: true,
      toolAlsoAllow: true,
      toolDeny: true,
      toolByProvider: true,
      toolByAgent: true,
      toolByGroup: true,
    },
  });

  let touched = 0;
  for (const row of rows) {
    const nextToolAllow = mapStringList(row.toolAllow);
    const nextToolAlsoAllow = mapStringList(row.toolAlsoAllow);
    const nextToolDeny = mapStringList(row.toolDeny);
    const nextToolByProvider = migrateJson(row.toolByProvider);
    const nextToolByAgent = migrateJson(row.toolByAgent);
    const nextToolByGroup = migrateJson(row.toolByGroup);

    const changed =
      !jsonEqual(nextToolAllow, row.toolAllow) ||
      !jsonEqual(nextToolAlsoAllow, row.toolAlsoAllow) ||
      !jsonEqual(nextToolDeny, row.toolDeny) ||
      !jsonEqual(nextToolByProvider, row.toolByProvider) ||
      !jsonEqual(nextToolByAgent, row.toolByAgent) ||
      !jsonEqual(nextToolByGroup, row.toolByGroup);

    if (!changed) continue;
    touched += 1;
    if (dryRun) {
      console.log(`Would migrate tool names for userAIConfig id=${row.id} userId=${row.userId}`);
      continue;
    }

    await prisma.userAIConfig.update({
      where: { id: row.id },
      data: {
        toolAllow: nextToolAllow,
        toolAlsoAllow: nextToolAlsoAllow,
        toolDeny: nextToolDeny,
        toolByProvider: toPrismaNullableJson(nextToolByProvider),
        toolByAgent: toPrismaNullableJson(nextToolByAgent),
        toolByGroup: toPrismaNullableJson(nextToolByGroup),
      },
    });
  }

  console.log(
    dryRun
      ? `Dry run complete. ${touched} row(s) need migration.`
      : `Migration complete. Updated ${touched} row(s).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
