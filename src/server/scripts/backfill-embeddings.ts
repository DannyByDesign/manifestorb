/**
 * Backfill embeddings for existing MemoryFact and Knowledge records
 * 
 * Run with: bunx tsx src/server/scripts/backfill-embeddings.ts
 * 
 * Part of the context and memory management system.
 */
import prisma from "@/server/db/client";
import { EmbeddingService } from "@/features/memory/embeddings/service";

// Rate limiting: OpenAI allows ~500 requests/min for embeddings
const RATE_LIMIT_DELAY_MS = 150;

async function backfillMemoryFacts() {
  console.log("🧠 Backfilling MemoryFact embeddings...\n");

  // Find records without embeddings
  // Since Prisma doesn't support vector columns directly, we use raw SQL
  const factsWithoutEmbeddings = await prisma.$queryRaw<{ id: string; key: string; value: string }[]>`
    SELECT id, key, value 
    FROM "MemoryFact" 
    WHERE embedding IS NULL
  `;

  console.log(`Found ${factsWithoutEmbeddings.length} memory facts without embeddings\n`);

  let success = 0;
  let failed = 0;

  for (const fact of factsWithoutEmbeddings) {
    try {
      const embedding = await EmbeddingService.generateEmbedding(`${fact.key}: ${fact.value}`);
      await prisma.$executeRaw`
        UPDATE "MemoryFact" 
        SET embedding = ${embedding}::vector 
        WHERE id = ${fact.id}
      `;
      console.log(`✓ MemoryFact ${fact.id}: ${fact.key}`);
      success++;
    } catch (e) {
      console.error(`✗ MemoryFact ${fact.id}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }

    // Rate limit to avoid hitting OpenAI limits
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  console.log(`\nMemoryFact backfill complete: ${success} success, ${failed} failed\n`);
  return { success, failed };
}

async function backfillKnowledge() {
  console.log("📚 Backfilling Knowledge embeddings...\n");

  // Find records without embeddings
  const itemsWithoutEmbeddings = await prisma.$queryRaw<{ id: string; title: string; content: string }[]>`
    SELECT id, title, content 
    FROM "Knowledge" 
    WHERE embedding IS NULL
  `;

  console.log(`Found ${itemsWithoutEmbeddings.length} knowledge items without embeddings\n`);

  let success = 0;
  let failed = 0;

  for (const item of itemsWithoutEmbeddings) {
    try {
      const embedding = await EmbeddingService.generateEmbedding(`${item.title}\n\n${item.content}`);
      await prisma.$executeRaw`
        UPDATE "Knowledge" 
        SET embedding = ${embedding}::vector 
        WHERE id = ${item.id}
      `;
      console.log(`✓ Knowledge ${item.id}: ${item.title}`);
      success++;
    } catch (e) {
      console.error(`✗ Knowledge ${item.id}: ${e instanceof Error ? e.message : String(e)}`);
      failed++;
    }

    // Rate limit
    await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  console.log(`\nKnowledge backfill complete: ${success} success, ${failed} failed\n`);
  return { success, failed };
}

async function main() {
  console.log("=".repeat(60));
  console.log("  Embedding Backfill Script");
  console.log("  Part of the Context & Memory Management System");
  console.log("=".repeat(60) + "\n");

  // Check if embedding service is available
  if (!EmbeddingService.isAvailable()) {
    console.error("❌ OPENAI_API_KEY is not configured. Cannot generate embeddings.");
    process.exit(1);
  }

  console.log("✓ OpenAI API key found\n");

  const memoryResult = await backfillMemoryFacts();
  const knowledgeResult = await backfillKnowledge();

  console.log("=".repeat(60));
  console.log("  Summary");
  console.log("=".repeat(60));
  console.log(`MemoryFact: ${memoryResult.success} success, ${memoryResult.failed} failed`);
  console.log(`Knowledge:  ${knowledgeResult.success} success, ${knowledgeResult.failed} failed`);
  console.log("=".repeat(60) + "\n");

  if (memoryResult.failed > 0 || knowledgeResult.failed > 0) {
    console.log("⚠️  Some embeddings failed to generate. Re-run the script to retry.");
  } else {
    console.log("✅ All embeddings generated successfully!");
  }
}

main()
  .catch((e) => {
    console.error("Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
