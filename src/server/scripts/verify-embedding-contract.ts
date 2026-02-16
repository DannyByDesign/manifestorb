/**
 * Verify vector-search contract for memory features.
 *
 * Usage:
 * - bunx tsx src/server/scripts/verify-embedding-contract.ts
 * - bunx tsx src/server/scripts/verify-embedding-contract.ts --ci
 */
import prisma from "@/server/db/client";

interface CheckResult {
  ok: boolean;
  details: Record<string, unknown>;
}

const REQUIRED_TABLES = ["MemoryFact", "Knowledge", "ConversationMessage"] as const;
const REQUIRED_INDEXES = [
  "MemoryFact_embedding_idx",
  "Knowledge_embedding_idx",
  "ConversationMessage_embedding_idx",
] as const;

async function queryExists(sql: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(sql);
  return Boolean(rows[0]?.exists);
}

async function runChecks(): Promise<CheckResult> {
  const hasVectorExtension = await queryExists(
    "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'vector') AS exists",
  );

  const tableEmbeddingColumns: Record<string, boolean> = {};
  for (const table of REQUIRED_TABLES) {
    const exists = await queryExists(
      `SELECT EXISTS(
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = '${table}'
          AND column_name = 'embedding'
      ) AS exists`,
    );
    tableEmbeddingColumns[table] = exists;
  }

  const indexes: Record<string, boolean> = {};
  for (const indexName of REQUIRED_INDEXES) {
    const exists = await queryExists(
      `SELECT EXISTS(
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = '${indexName}'
      ) AS exists`,
    );
    indexes[indexName] = exists;
  }

  const missingTables = Object.entries(tableEmbeddingColumns)
    .filter(([, exists]) => !exists)
    .map(([table]) => table);
  const missingIndexes = Object.entries(indexes)
    .filter(([, exists]) => !exists)
    .map(([index]) => index);

  return {
    ok: hasVectorExtension && missingTables.length === 0,
    details: {
      hasVectorExtension,
      tableEmbeddingColumns,
      indexes,
      missingTables,
      missingIndexes,
    },
  };
}

async function main() {
  const ciMode = process.argv.includes("--ci");

  const result = await runChecks();
  const summary = JSON.stringify(result.details, null, 2);

  if (result.ok) {
    console.log("embedding_contract:ok");
    console.log(summary);
  } else {
    console.error("embedding_contract:failed");
    console.error(summary);
    if (ciMode) {
      process.exitCode = 1;
    }
  }

  if (!result.ok && !ciMode) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("embedding_contract:error", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
