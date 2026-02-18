# Memory System Architecture

A comprehensive overview of the context and memory management system.

**Last Updated:** January 29, 2026

> **UNIFIED MEMORY:** The assistant is "one person" across all platforms.
> History, summaries, and facts are shared across Web, Slack, Discord, and Telegram.

---

## Overview

The memory system enables the AI assistant to:
1. **Remember** facts about the user across conversations
2. **Retrieve** relevant context for each interaction
3. **Learn** automatically from conversation patterns
4. **Search** semantically across all stored knowledge

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERACTION                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            ENTRY POINTS                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │   Web Chat   │  │  API Chat    │  │   Channels   │                   │
│  │   chat.ts    │  │  route.ts    │  │  router.ts   │                   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                   │
└─────────┼─────────────────┼─────────────────┼───────────────────────────┘
          │                 │                 │
          └─────────────────┼─────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONTEXT MANAGER (UNIFIED)                         │
│                   memory/context-manager.ts                              │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │              buildContextPack({ user, ... })                     │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │    │
│  │  │UserSummary│ │  Facts   │  │Knowledge │  │ History  │        │    │
│  │  │ (8K)     │  │  (4K)    │  │ (12K)    │  │ (20K)    │        │    │
│  │  │ unified  │  │ per-user │  │per-acct  │  │ unified  │        │    │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          AI AGENT                                        │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │                    SYSTEM PROMPT                                │     │
│  │  • User preferences    • Open tasks                            │     │
│  │  • Recent context      • Memory facts                          │     │
│  │  • Knowledge base      • Conversation history                  │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │                       TOOLS                                     │     │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐               │     │
│  │  │rememberFact│  │recallFacts │  │ forgetFact │               │     │
│  │  └────────────┘  └────────────┘  └────────────┘               │     │
│  └────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    MEMORY RECORDING (Background)                         │
│                  Triggers at 120K tokens accumulated                     │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │         MemoryRecordingService.shouldRecord(userId)             │     │
│  │  • Check privacy settings                                       │     │
│  │  • Check rate limit (30 min cooldown)                          │     │
│  │  • Estimate tokens of ALL user messages (unified)              │     │
│  │  • Trigger if >= 120K tokens                                    │     │
│  └────────────────────────────────────────────────────────────────┘     │
│                              │                                           │
│                              ▼                                           │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │              /api/jobs/record-memory                            │     │
│  │  • Fetch ALL user messages (unified across platforms)          │     │
│  │  • Generate compressed summary → UserSummary                   │     │
│  │  • Extract facts (up to 20) with evidence                      │     │
│  │  • Validate and deduplicate facts                              │     │
│  │  • Store to MemoryFact table                                   │     │
│  │  • Queue embedding generation                                   │     │
│  └────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DATA STORES                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │   MemoryFact     │  │    Knowledge     │  │   UserSummary    │      │
│  │  • key           │  │  • title         │  │  • userId (uniq) │      │
│  │  • value         │  │  • content       │  │  • summary       │      │
│  │  • embedding     │  │  • embedding     │  │  • lastMessageAt │      │
│  │  • confidence    │  │  • type          │  │  (UNIFIED)       │      │
│  │  • scope         │  │                  │  │                   │      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
│                         PostgreSQL + pgvector                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
memory/
├── ARCHITECTURE.md          # This file
├── service.ts               # MemoryRecordingService (trigger logic)
├── decay.ts                 # Memory decay algorithm
├── context-manager.ts       # Context pack builder (output side)
└── embeddings/              # Vector embedding subsystem
    ├── service.ts           # Embedding generation
    ├── search.ts            # Semantic search
    ├── cache.ts             # Redis cache layer
    ├── queue.ts             # Background job queue
    └── README.md            # Embeddings documentation
```

---

## Components

### 1. Context Manager (Unified)

**File:** `src/server/features/memory/context-manager.ts`

Builds a **unified** context pack for each AI interaction. Fetches history
and summary from ALL user conversations, not just the current one.

```typescript
const pack = await ContextManager.buildContextPack({
  user,           // Required - used for unified retrieval
  emailAccount,
  messageContent,
  conversationId  // Optional - not used for retrieval
});
```

**Key Change:** History and summary are fetched by `userId`, not `conversationId`,
so the assistant has the same context regardless of which platform the user is on.

This same `ContextPack` is also reused by the AI runtime turn compiler (in a clipped form) to resolve follow-up turns without introducing a separate "compiler memory" system.

**Context Budget:**

| Component | Max Characters | Purpose |
|-----------|----------------|---------|
| System Prompt | 12,000 | Base instructions |
| Summary | 8,000 | Conversation context |
| Facts | 4,000 | User preferences/info |
| Knowledge | 12,000 | Domain knowledge |
| History | 20,000 | Recent messages |
| Reserved | 52,000 | Response buffer |
| **Total** | **200,000** | |

### 2. Runtime Memory Tools

**Files:**
- `src/server/features/ai/tools/runtime/capabilities/memory.ts`
- `src/server/features/ai/tools/runtime/capabilities/executors/memory.ts`
- `src/server/features/ai/tools/runtime/capabilities/registry.ts`

On-demand memory management via runtime tools:

| Tool | Description |
|------|-------------|
| `rememberFact` | Store a fact about the user |
| `recallFacts` | Retrieve facts by key or semantic search |
| `forgetFact` | Delete a specific fact |

### 3. Memory Recording Service (Unified)

**File:** `src/server/features/memory/service.ts`

Automatic fact extraction from **all user conversations** (unified):

```typescript
// Trigger check - uses userId, not conversationId
if (await MemoryRecordingService.shouldRecord(userId)) {
  await MemoryRecordingService.enqueueMemoryRecording(userId, email);
}
```

**Key Change:** Recording is at the user level, not conversation level.
All messages across all platforms are considered together.

**Trigger Conditions:**
- Privacy enabled for user
- 30+ minutes since last recording
- 120K+ tokens accumulated **across all user conversations**

### 4. Embedding Service

**File:** `src/server/features/memory/embeddings/service.ts`

Generates vector embeddings for semantic search:

```typescript
const embedding = await EmbeddingService.generateEmbedding(text);
```

**Model:** `text-embedding-3-small` (OpenAI)
- 1536 dimensions
- $0.02 per 1M tokens

### 5. Semantic Search

**File:** `src/server/features/memory/embeddings/search.ts`

Hybrid search combining semantic and keyword matching:

```typescript
const results = await searchMemoryFacts({
  userId,
  query: "email preferences",
  limit: 10
});
```

### 6. Memory Decay

**File:** `src/server/features/memory/decay.ts`

Manages memory lifecycle:
- Time-based decay (30-day half-life)
- Usage-based boosting
- Soft deletion for stale facts

---

## Data Models

### MemoryFact

Stores user-specific facts:

```prisma
model MemoryFact {
  id              String    @id @default(cuid())
  userId          String
  key             String    // e.g., "preference_email_style"
  value           String    // e.g., "short and direct"
  scope           String    // Category: contact, preference, etc.
  confidence      Float     // 0.0 - 1.0
  embedding       Float[]   // 1536-dim vector
  
  // Decay fields
  expiresAt       DateTime?
  lastAccessedAt  DateTime?
  accessCount     Int       @default(0)
  isActive        Boolean   @default(true)
  
  @@unique([userId, key])
}
```

### Knowledge

Stores domain knowledge:

```prisma
model Knowledge {
  id        String    @id @default(cuid())
  userId    String
  title     String
  content   String
  type      String    // writing_style, email_pattern, etc.
  embedding Float[]
}
```

### UserSummary (Unified)

Stores **user-level** compressed state across all platforms:

```prisma
model UserSummary {
  id            String    @id @default(cuid())
  userId        String    @unique  // One per user
  summary       String
  lastMessageAt DateTime
}
```

**Key Change:** Replaces per-conversation summaries for context retrieval.
The assistant has one continuous memory across Web, Slack, Discord, and Telegram.

### ConversationSummary (Legacy)

> **Deprecated:** Use `UserSummary` for unified memory. This table is preserved
> for backward compatibility and platform-specific analytics.

```prisma
model ConversationSummary {
  id             String    @id @default(cuid())
  conversationId String    @unique
  summary        String
  lastMessageAt  DateTime
}
```

---

## Fact Categories

The Memory Recording Module extracts facts in these categories:

| Category | Example Keys | Example Values |
|----------|-------------|----------------|
| `contact` | `manager_name`, `team_lead` | "Sarah Johnson, VP Marketing" |
| `preference` | `email_style`, `meeting_time` | "short and direct, bullet points" |
| `context` | `current_project`, `company_name` | "Q3 revenue report for board" |
| `behavior` | `response_time`, `work_hours` | "replies within 2 hours to urgent" |
| `deadline` | `board_presentation`, `review_due` | "March 15, 2026" |
| `relationship` | `sarah_dynamic`, `team_tension` | "sends fake-urgent emails often" |

---

## Memory Quality Controls

### 1. Fact Validation

Before storing extracted facts:
- Confidence >= 0.6 required
- Value must be 2+ characters
- No sensitive data (passwords, SSNs, credit cards)
- Evidence quote must appear in user messages

### 2. Key Normalization

```typescript
function normalizeKey(category: string, key: string): string {
  // "User's Email Style" → "preference_users_email_style"
  return `${category}_${key.toLowerCase().replace(/\s+/g, '_')}`;
}
```

### 3. Semantic Deduplication

Before storing, check for similar existing facts:
- Similarity threshold: 0.92
- Higher confidence fact wins

### 4. Memory Decay

Facts have lifecycle management:
- `lastAccessedAt` updated on retrieval
- `accessCount` tracks usage
- `isActive` for soft deletion
- `expiresAt` for time-limited facts

---

## API Endpoints

### Memory Recording Job (Unified)

```
POST /api/jobs/record-memory
Authorization: Bearer {JOBS_SHARED_SECRET}

Request:
{
  "userId": "user_123",
  "email": "user@example.com"
}

Response:
{
  "success": true,
  "stats": {
    "messagesProcessed": 150,  // From ALL platforms
    "estimatedTokens": 125000,
    "factsExtracted": 12,
    "factsRejected": 3,
    "factsDuplicate": 2
  }
}
```

**Key Change:** Takes `userId` instead of `conversationId`. Processes messages
from all user conversations and updates `UserSummary`.

---

## Models Used

| Component | Model | Provider | Cost |
|-----------|-------|----------|------|
| Agent | `gemini-2.5-flash` | Google | Primary |
| Memory Recording | `gemini-2.5-flash` | Google | Primary |
| Embeddings | `text-embedding-3-small` | OpenAI | $0.02/1M |

---

## Unified Memory Design

The assistant is **one person** across all platforms:

| Component | Scope | Shared? |
|-----------|-------|---------|
| MemoryFact | Per user (`userId`) | Yes - facts learned on Slack available on web |
| Knowledge | Per email account | Yes - shared across platforms for same account |
| UserSummary | Per user (`userId`) | Yes - single summary spans all conversations |
| History | Per user (`userId`) | Yes - recent messages from all platforms |

**Benefits:**
- User doesn't have to repeat information across platforms
- Context continuity when switching between Web, Slack, Discord, Telegram
- Single summary avoids divergent "personalities" per channel

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/server/features/memory/context-manager.ts` | Builds unified context packs |
| `src/server/features/memory/service.ts` | User-level recording trigger |
| `src/server/features/memory/decay.ts` | Memory decay logic |
| `src/server/features/memory/embeddings/service.ts` | Embedding generation |
| `src/server/features/memory/embeddings/search.ts` | Semantic search |
| `src/server/features/memory/embeddings/queue.ts` | Embedding job queue |
| `src/server/features/memory/embeddings/cache.ts` | Embedding cache |
| `src/server/features/ai/tools/runtime/capabilities/memory.ts` | Memory capability implementation |
| `src/server/features/ai/tools/runtime/capabilities/executors/memory.ts` | Memory tool executor bindings |
| `src/server/features/ai/tools/runtime/capabilities/registry.ts` | Memory tool contracts/schemas |
| `src/server/features/channels/executor.ts` | External chat agent executor |
| `src/app/api/jobs/record-memory/route.ts` | User-level recording job |
| `src/server/scripts/backfill-user-summary.ts` | Migration script |

---

## Environment Variables

Required for the memory system:

```env
# Required
OPENAI_API_KEY=sk-...          # For embeddings and memory extraction
JOBS_SHARED_SECRET=...         # For job authentication

# Optional
REDIS_URL=...                  # For embedding cache and queue
```

---

## Observability

### PostHog Events

| Event | When |
|-------|------|
| `memory_fact_created` | Agent stores fact via tool |
| `memory_facts_recalled` | Agent retrieves facts |
| `memory_fact_deleted` | Agent deletes fact |
| `memory_facts_extracted` | Auto-extraction from summary |
| `memory_recording_completed` | Recording job finishes |
| `context_pack_built` | Context pack assembled |

### Redis Metrics

- Embedding API calls and tokens
- Cache hit/miss rates
- Queue depth and processing time

---

## See Also

- [LLM Registry](../../../../docs/LLM_REGISTRY.md) - Full model documentation
- [Implementation Plan](../../../../docs/CONTEXT-MEMORY-IMPLEMENTATION-PLAN.md) - Step-by-step build guide
- [Embeddings README](./embeddings/README.md) - Embedding subsystem details
