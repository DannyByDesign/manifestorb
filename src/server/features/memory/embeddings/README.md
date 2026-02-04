# Embeddings Module

Vector embedding generation and semantic search for the memory system.

## Overview

This module provides:
1. **Embedding Generation** - Convert text to 1536-dimensional vectors
2. **Semantic Search** - Find similar content using vector similarity
3. **Caching** - Redis-based cache to reduce API costs
4. **Queue** - Reliable background job queue for embedding generation

## Files

| File | Purpose |
|------|---------|
| `service.ts` | Core embedding generation with retry and caching |
| `search.ts` | Semantic and hybrid search across MemoryFact/Knowledge |
| `cache.ts` | Redis-based embedding cache (24h TTL) |
| `queue.ts` | Reliable job queue for async embedding generation |

## Model

| Property | Value |
|----------|-------|
| **Model** | `text-embedding-3-small` |
| **Provider** | OpenAI |
| **Dimensions** | 1536 |
| **Max Input** | 8,191 tokens (~30,000 chars) |
| **Cost** | $0.02 / 1M tokens |

## Usage

### Generate Embedding

```typescript
import { EmbeddingService, EMBEDDING_DIMENSION } from "@/features/memory/embeddings/service";

// Check availability
if (EmbeddingService.isAvailable()) {
  const embedding = await EmbeddingService.generateEmbedding("Hello world");
  // embedding: number[] of length 1536
}
```

### Batch Generation

```typescript
const embeddings = await EmbeddingService.generateEmbeddings([
  "First text",
  "Second text",
  "Third text"
]);
// embeddings: number[][] - array of 1536-dim vectors
```

### Queue Embedding Job

For non-blocking embedding generation:

```typescript
import { EmbeddingQueue } from "@/features/memory/embeddings/queue";

await EmbeddingQueue.enqueue({
  table: "MemoryFact",  // or "Knowledge"
  recordId: "fact_123",
  text: "preference_email_style: short and direct"
});
```

### Semantic Search

```typescript
import { searchMemoryFacts, searchKnowledge } from "@/features/memory/embeddings/search";

// Search memory facts
const facts = await searchMemoryFacts({
  userId: "user_123",
  query: "email preferences",
  limit: 10
});

// Search knowledge base
const knowledge = await searchKnowledge({
  emailAccountId: "account_123",
  query: "writing style",
  limit: 5
});
```

### Check for Duplicates

```typescript
import { checkForDuplicate } from "@/features/memory/embeddings/search";

const duplicate = await checkForDuplicate({
  userId: "user_123",
  key: "preference_email_style",
  value: "short and direct"
});

if (duplicate) {
  console.log("Similar fact exists:", duplicate.key);
}
```

## Caching

Embeddings are cached in Redis to reduce API costs:

| Setting | Value |
|---------|-------|
| Key Format | `emb:{sha256(text)[0:16]}` |
| TTL | 24 hours |
| Storage | JSON-encoded float array |

```typescript
import { getCachedEmbedding, cacheEmbedding } from "@/features/memory/embeddings/cache";

// Check cache
const cached = await getCachedEmbedding(text);
if (!cached) {
  const embedding = await EmbeddingService.generateEmbedding(text);
  await cacheEmbedding(text, embedding);
}
```

## Queue Processing

The embedding queue uses Redis for reliability:

```typescript
// Process next job
await EmbeddingQueue.processNext();

// Process all pending jobs
await EmbeddingQueue.processAll();

// Recover stale jobs (>1 min old)
await EmbeddingQueue.recoverStale();

// Get queue stats
const stats = await EmbeddingQueue.getStats();
// { pending: 5, processing: 1, failed: 0 }
```

## Database Schema

Embeddings are stored as `vector(1536)` columns (requires pgvector):

```sql
-- MemoryFact
ALTER TABLE "MemoryFact" ADD COLUMN "embedding" vector(1536);
CREATE INDEX ON "MemoryFact" USING ivfflat (embedding vector_cosine_ops);

-- Knowledge  
ALTER TABLE "Knowledge" ADD COLUMN "embedding" vector(1536);
CREATE INDEX ON "Knowledge" USING ivfflat (embedding vector_cosine_ops);
```

## Environment Variables

```env
# Required
OPENAI_API_KEY=sk-...    # For embedding generation

# Optional (for caching/queue)
REDIS_URL=redis://...    # Redis connection string
```

## Error Handling

The service includes:
- **Retry with exponential backoff** (3 attempts: 1s, 2s, 4s)
- **Request timeout** (30 seconds)
- **Graceful degradation** (returns null if unavailable)

```typescript
// Service handles errors internally
try {
  const embedding = await EmbeddingService.generateEmbedding(text);
} catch (error) {
  // Only throws after all retries exhausted
  logger.error("Embedding generation failed", { error });
}
```

## See Also

- [Memory Architecture](../ARCHITECTURE.md)
- [LLM Registry](../../../../../docs/LLM_REGISTRY.md)
- [Memory Tools](../../ai/memory-tools.ts)
