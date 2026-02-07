# Issue 24: Add Relevance Filtering to Conversation History

**Severity:** MEDIUM
**Category:** Context & Memory

---

## Problem

In `src/server/features/memory/context-manager.ts`, the `buildContextPack()` function fetches the last 30 messages across ALL conversations without any relevance filtering (around lines 170-175):

```typescript
const [rawHistory, userSummary] = await Promise.all([
  prisma.conversationMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 30
  }),
  // ...
]);
```

A message about scheduling gets the same history context as one about email filing. If the user was discussing email rules yesterday and now asks about calendar availability, the last 30 messages are all about rules -- providing irrelevant context and wasting tokens.

---

## Root Cause

History retrieval uses a simple recency-based query with no topic relevance.

---

## Step-by-Step Fix

### Step 1: Add embedding-based history retrieval

The codebase already has embedding infrastructure for facts and knowledge search. Extend it for conversation messages.

**File:** `src/server/features/memory/embeddings/search.ts`

Add a new function for searching conversation history by relevance:

```typescript
/**
 * Search conversation history by semantic relevance to the current message.
 * Returns messages sorted by relevance score.
 */
export async function searchConversationHistory({
  userId,
  query,
  limit,
}: {
  userId: string;
  query: string;
  limit: number;
}): Promise<Array<{ item: ConversationMessage; score: number }>> {
  // Generate embedding for the current query
  const queryEmbedding = await generateEmbedding(query);
  const vectorLiteral = toPgVectorLiteral(queryEmbedding);

  // Search conversation messages by embedding similarity
  const results = await prisma.$queryRaw<
    Array<ConversationMessage & { similarity: number }>
  >`
    SELECT cm.*, 1 - (cm.embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}) as similarity
    FROM "ConversationMessage" cm
    WHERE cm."userId" = ${userId}
      AND cm.embedding IS NOT NULL
      AND 1 - (cm.embedding <=> ${Prisma.raw(`'${vectorLiteral}'::vector`)}) > 0.3
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  return results.map(r => ({
    item: r,
    score: r.similarity,
  }));
}
```

**Note:** This requires `ConversationMessage` to have an `embedding` column. If it doesn't exist, see Step 2.

### Step 2: Add embedding column to ConversationMessage (if needed)

**File:** `prisma/schema.prisma`

Check if `ConversationMessage` already has an embedding field. If not:

```prisma
model ConversationMessage {
  // ... existing fields ...
  embedding Unsupported("vector(768)")?
}
```

Create migration:
```bash
bunx prisma migrate dev --name add_conversation_message_embedding
```

### Step 3: Generate embeddings when persisting messages

**File:** `src/server/features/memory/context-manager.ts` (or wherever messages are persisted)

After creating a `ConversationMessage`, generate and store its embedding:

```typescript
// After creating the message:
import { generateEmbedding, toPgVectorLiteral } from "@/features/memory/embeddings/search";

// Fire and forget -- don't block the response
(async () => {
  try {
    const embedding = await generateEmbedding(messageContent);
    const vectorLiteral = toPgVectorLiteral(embedding);
    await prisma.$executeRaw`
      UPDATE "ConversationMessage"
      SET embedding = ${Prisma.raw(`'${vectorLiteral}'::vector`)}
      WHERE id = ${messageId}
    `;
  } catch (e) {
    // Non-critical -- message is already saved
  }
})();
```

### Step 4: Use hybrid retrieval in buildContextPack

**File:** `src/server/features/memory/context-manager.ts`

Replace the simple recency query with a hybrid approach: recent messages + semantically relevant messages.

```typescript
// Replace the rawHistory fetch (around line 170):

// Hybrid history: recent + relevant
const [recentHistory, relevantHistory] = await Promise.all([
  // Always include the last 10 messages for immediate context
  prisma.conversationMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  }),
  // Also fetch up to 10 semantically relevant older messages
  messageContent.trim().length > 0
    ? searchConversationHistory({
        userId: user.id,
        query: messageContent,
        limit: 10,
      }).then(results => results.map(r => r.item))
    : Promise.resolve([]),
]);

// Merge and deduplicate, maintaining chronological order
const seenIds = new Set<string>();
const mergedHistory: ConversationMessage[] = [];
for (const msg of [...recentHistory, ...relevantHistory]) {
  if (!seenIds.has(msg.id)) {
    seenIds.add(msg.id);
    mergedHistory.push(msg);
  }
}
// Sort chronologically (oldest first)
const history = mergedHistory
  .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
```

### Step 5: Handle the case where embeddings don't exist yet

For backward compatibility, if no messages have embeddings, the `searchConversationHistory` query returns empty and the system falls back to the recent 10 messages -- still an improvement over 30 unfiltered messages.

---

## Files to Modify

- `src/server/features/memory/context-manager.ts` -- hybrid history retrieval
- `src/server/features/memory/embeddings/search.ts` -- add conversation history search
- `prisma/schema.prisma` -- add embedding column to ConversationMessage (if needed)

## Files to Create

- `prisma/migrations/<timestamp>_add_conversation_message_embedding/migration.sql` (if needed)

## Testing Instructions

1. Verify TypeScript compiles: `bunx tsc --noEmit`
2. Create some conversation messages about different topics (scheduling, email rules, tasks)
3. Ask about scheduling -- verify the history context includes scheduling-related messages preferentially
4. Run tests: `bunx vitest run src/server/features/memory/`

## Rollback Plan

Revert to the simple `take: 30` query. The embedding column can remain (unused but harmless).

## Dependencies on Other Issues

- **Issue 12** (enrich context pack): Both improve the context pack. This issue focuses on history quality; Issue 12 focuses on adding new data types.
- **Issue 26** (proactive context): Relevance-filtered history supports proactive surfacing.
