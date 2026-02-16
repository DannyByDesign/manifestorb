# Agentic Email + Calendar Context/Memory Master Plan (Atomic)

**Status:** Draft for implementation
**Date:** 2026-02-16
**Primary Goal:** Build an assistant that is best-in-class at both:
1. **Email/calendar execution correctness** (must-have baseline)
2. **Long/short-term context and memory quality** (must-have UX differentiator)

---

## 1. Product Objective and Constraints

### Problem We Are Solving
Users need an assistant that can both execute reliably (email + calendar actions) and remember interaction history across threads, meetings, and time. Today, these capabilities are partially implemented but fragmented.

### Approach
Use a **wrangle/upgrade strategy** (not full rewrite):
1. Keep `amodel` as the execution foundation (email/calendar action plane).
2. Add a robust memory/context plane inspired by OpenClaw patterns.
3. Add context window control plane (budgeting, pruning, compaction, overflow recovery).

### Non-Negotiable Outcomes
1. Never regress action safety/correctness.
2. Memory answers must be grounded and confidence-scored.
3. Context handling must be observable and resilient under long sessions.

### Online References
- LangGraph Memory Overview: https://docs.langchain.com/oss/javascript/langgraph/memory
- LlamaIndex Agent Memory: https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/
- Letta Memory Blocks: https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- MemGPT paper: https://arxiv.org/abs/2310.08560

---

## 2. Current Audit Baseline (Gaps to Close)

This plan explicitly closes the audit gaps found in:
- `/Users/dannywang/.codex/worktrees/f15f/amodel`
- `/Users/dannywang/Projects/openclaw`

### Gap List
1. `ContextManager.buildContextPack()` is not wired into main runtime turns.
2. Memory tools exist but are not part of active runtime tool packs.
3. Embedding schema/ORM contract drift risk.
4. Conversation-message embeddings are not fully fed by active pipelines.
5. Recall tool is keyword-only despite semantic infrastructure.
6. Need to preserve/extend strong memory recording pipeline in `amodel`.
7. Missing context robustness features in runtime path (prune/compact/retry/flush).
8. Missing first-class episodic/relationship memory model for CRM-like recall.
9. Missing formal eval harness + rollout SLOs for memory quality.

---

## 3. Target System Architecture

## Problem We Are Solving
Current system has strong components, but no unified architecture that guarantees high-quality execution + memory continuity.

## Approach
Implement a **three-plane architecture**:
1. **Execution Plane**: domain actions (email/calendar/tasks/rules).
2. **Memory Plane**: semantic + episodic + procedural memories.
3. **Context Control Plane**: context assembly budget, pruning, compaction, recovery.

## Online References
- ReAct: https://arxiv.org/abs/2210.03629
- Self-RAG: https://arxiv.org/abs/2310.11511
- Generative Agents: https://arxiv.org/abs/2304.03442
- GraphRAG: https://arxiv.org/abs/2404.16130
- HippoRAG: https://arxiv.org/abs/2405.14831
- A-MEM: https://arxiv.org/abs/2502.12110
- Zep paper: https://arxiv.org/abs/2501.13956
- Mem0 paper: https://arxiv.org/abs/2504.19413

---

## 4. Workstream-by-Workstream Atomic Plan

Each workstream includes: problem, approach, atomic tasks, code touchpoints, OpenClaw snippet(s), online references, and DoD.

---

### WS-01: Wire Context Pack into Main Runtime (Gap #1)

#### Problem
Main runtime currently hydrates only trimmed user message and does not inject the full context pack used elsewhere.

#### Approach
Extend runtime hydrator to build and pass a `ContextPack` for every turn, with lane-aware context budgets.

#### Atomic Tasks
1. Add `contextPack` to runtime hydrated context type.
2. In runtime hydrator, call `ContextManager.buildContextPack()` with current user/account/message.
3. Make native runtime prompt writer consume `contextPack` slots:
   - user summary
   - relevant facts
   - relevant knowledge
   - relevant history
   - pending state
   - near-term domain context (emails/events/tasks)
4. Add fallback behavior if context build fails (degrade gracefully; do not block execution).
5. Add telemetry for context pack size and retrieval hit counts.
6. Add tests for:
   - context pack present on normal turns
   - context tier reduction under budget pressure
   - graceful degradation when embeddings unavailable

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/context/hydrator.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/index.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/attempt-loop.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/context-manager.ts`

#### OpenClaw Reference Snippet (pattern: force memory recall behavior)
```ts
function buildMemorySection(params: { isMinimal: boolean; availableTools: Set<string> }) {
  if (params.isMinimal) return [];
  if (!params.availableTools.has("memory_search") && !params.availableTools.has("memory_get")) {
    return [];
  }
  return [
    "## Memory Recall",
    "Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md; then use memory_get to pull only the needed lines. If low confidence after search, say you checked.",
    "",
  ];
}
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/system-prompt.ts`

#### Online References
- LangGraph add memory: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LangGraph memory concepts: https://docs.langchain.com/oss/javascript/langgraph/memory

#### Definition of Done
- All main chat turns include structured context pack metadata in logs.
- Unit/integration tests confirm context pack is consumed by prompt build path.

---

### WS-02: Make Memory Tools First-Class in Runtime Tool Registry (Gap #2)

#### Problem
Memory tools exist but are not wired into active runtime tool packs.

#### Approach
Add a memory tool pack and enforce tool-policy integration to keep behavior safe and configurable.

#### Atomic Tasks
1. Add new internal tool pack `memory` with read + write + forget + list actions.
2. Register pack in runtime pack registry.
3. Add policy group `group:memory` equivalents and per-layer allow/deny support.
4. Restrict mutating memory tools behind policy checks and approval rules.
5. Add semantic routing hints to call memory tools for recall questions.
6. Add tests for policy boundaries and availability by profile/provider/agent/group.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/tools/packs/registry.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/tools/packs/loader.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/session.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/memory-tools.ts`

#### OpenClaw Reference Snippet (pattern: memory tool registration as plugin slot)
```ts
const memoryCorePlugin = {
  id: "memory-core",
  kind: "memory",
  register(api) {
    api.registerTool(
      (ctx) => {
        const memorySearchTool = api.runtime.tools.createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        const memoryGetTool = api.runtime.tools.createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        });
        if (!memorySearchTool || !memoryGetTool) return null;
        return [memorySearchTool, memoryGetTool];
      },
      { names: ["memory_search", "memory_get"] },
    );
  },
};
```
Source: `/Users/dannywang/Projects/openclaw/extensions/memory-core/index.ts`

#### Online References
- OpenClaw memory plugin docs: https://docs.mem0.ai/integrations/openclaw
- Letta memory blocks: https://docs.letta.com/guides/core-concepts/memory/memory-blocks

#### Definition of Done
- Memory tools visible in runtime tool registry and callable when policy allows.
- Policy tests pass for allow/deny layering.

---

### WS-03: Fix Embedding Schema Contract and Runtime Guardrails (Gap #3)

#### Problem
Vector columns exist via migrations/raw SQL, but schema contracts are fragile and can drift.

#### Approach
Create a strict embedding contract with startup checks and safe fallback mode.

#### Atomic Tasks
1. Introduce startup health check for embedding prerequisites:
   - pgvector extension
   - required columns/indexes
2. Add explicit feature flags:
   - `memory.semantic.enabled`
   - `memory.semantic.fallback=keyword`
3. Fail soft in production if semantic path unavailable; emit high-severity telemetry.
4. Create migration verifier script for CI/deploy checks.
5. Add smoke test that executes semantic query on each table class.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/prisma/schema.prisma`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/prisma/migrations/20260202000000_add_embeddings/migration.sql`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/prisma/migrations/20260209100000_ensure_embedding_columns/migration.sql`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/embeddings/search.ts`

#### OpenClaw Reference Snippet (pattern: graceful vector fallback)
```ts
private async ensureVectorReady(dimensions?: number): Promise<boolean> {
  if (!this.vector.enabled) return false;
  if (!this.vectorReady) {
    this.vectorReady = this.withTimeout(
      this.loadVectorExtension(),
      VECTOR_LOAD_TIMEOUT_MS,
      `sqlite-vec load timed out after ${Math.round(VECTOR_LOAD_TIMEOUT_MS / 1000)}s`,
    );
  }
  try {
    return await this.vectorReady;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.vector.available = false;
    this.vector.loadError = message;
    this.vectorReady = null;
    log.warn(`sqlite-vec unavailable: ${message}`);
    return false;
  }
}
```
Source: `/Users/dannywang/Projects/openclaw/src/memory/manager.ts`

#### Online References
- Pinecone hybrid architecture guidance: https://docs.pinecone.io/guides/search/hybrid-search
- Qdrant hybrid queries: https://qdrant.tech/documentation/concepts/hybrid-queries/

#### Definition of Done
- Deploy-time health endpoint reports semantic readiness.
- Runtime safely falls back without hard failures.

---

### WS-04: Ingest Conversation Embeddings End-to-End (Gap #4)

#### Problem
`searchConversationHistory` expects embeddings, but active embedding queue supports only selected tables.

#### Approach
Expand embedding pipeline and backfills to include `ConversationMessage` continuously.

#### Atomic Tasks
1. Expand embedding queue job type to include `ConversationMessage`.
2. Trigger enqueue on message persistence (user + assistant, configurable).
3. Add batch backfill script for `ConversationMessage`.
4. Add worker capacity controls and lag metrics.
5. Add PII guardrails before embedding (redaction rules).
6. Add integration tests for retrieval after fresh message writes.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/embeddings/queue.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/embeddings/search.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/scripts/backfill-embeddings.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/message-processor.ts`

#### OpenClaw Reference Snippet (pattern: async indexing on change)
```ts
private ensureWatcher() {
  if (!this.sources.has("memory") || !this.settings.sync.watch || this.watcher) return;
  const watchPaths = new Set<string>([
    path.join(this.workspaceDir, "MEMORY.md"),
    path.join(this.workspaceDir, "memory.md"),
    path.join(this.workspaceDir, "memory"),
  ]);
  this.watcher = chokidar.watch(Array.from(watchPaths), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: this.settings.sync.watchDebounceMs,
      pollInterval: 100,
    },
  });
  const markDirty = () => {
    this.dirty = true;
    this.scheduleWatchSync();
  };
  this.watcher.on("add", markDirty);
  this.watcher.on("change", markDirty);
  this.watcher.on("unlink", markDirty);
}
```
Source: `/Users/dannywang/Projects/openclaw/src/memory/manager.ts`

#### Online References
- LangGraph short-term memory persistence: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LlamaIndex memory usage: https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/

#### Definition of Done
- New conversation messages become retrievable semantically within SLA.
- Backfill script reaches 100% coverage on existing rows.

---

### WS-05: Upgrade Recall to Hybrid Retrieval + Reranking (Gap #5)

#### Problem
Current recall path is mostly keyword matching, reducing recall quality for paraphrased or temporally nuanced queries.

#### Approach
Adopt hybrid retrieval (lexical + semantic) with weighted fusion and reranking.

#### Atomic Tasks
1. Replace keyword-only recall tool path with hybrid search service.
2. Implement weighted fusion config:
   - `vectorWeight`
   - `textWeight`
   - `candidateMultiplier`
3. Add optional reranker stage for top-K candidates.
4. Add source-aware blending:
   - fact store
   - episodic store
   - conversation history
5. Add confidence and evidence fields to tool outputs.
6. Add benchmark suite for retrieval relevance and consistency.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/memory-tools.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/embeddings/search.ts`

#### OpenClaw Reference Snippet (hybrid merge)
```ts
export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
}) {
  const byId = new Map<string, { vectorScore: number; textScore: number; path: string; startLine: number; endLine: number; snippet: string; source: HybridSource }>();

  for (const r of params.vector) {
    byId.set(r.id, {
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) existing.snippet = r.snippet;
    } else {
      byId.set(r.id, {
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
      });
    }
  }

  return Array.from(byId.values())
    .map((entry) => ({
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score: params.vectorWeight * entry.vectorScore + params.textWeight * entry.textScore,
      snippet: entry.snippet,
      source: entry.source,
    }))
    .sort((a, b) => b.score - a.score);
}
```
Source: `/Users/dannywang/Projects/openclaw/src/memory/hybrid.ts`

#### Online References
- Pinecone hybrid search: https://docs.pinecone.io/guides/search/hybrid-search
- Weaviate hybrid search: https://docs.weaviate.io/weaviate/search/hybrid
- Qdrant hybrid queries: https://qdrant.tech/documentation/concepts/hybrid-queries/

#### Definition of Done
- Hybrid retrieval replaces keyword-only recall path in production.
- Retrieval eval shows measurable gains in recall/precision for paraphrased prompts.

---

### WS-06: Preserve and Extend Memory Recording Pipeline (Gap #6)

#### Problem
`amodel` already has strong extraction/validation, but it must evolve to support richer episodic memory and stronger governance.

#### Approach
Keep current extraction job and extend outputs into structured memory assertions + episodes.

#### Atomic Tasks
1. Keep current fact extraction pipeline as ingestion front door.
2. Add extraction outputs:
   - relationship assertions
   - commitment assertions
   - episode-level summary candidates
3. Version extraction schema and parser to avoid silent breakage.
4. Add data retention/privacy policies per memory class.
5. Add write conflict handling and contradiction detection.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/app/api/jobs/record-memory/route.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/service.ts`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/memory/decay.ts`

#### OpenClaw Reference Snippet (pattern: memory tools as explicit operations)
```ts
return {
  label: "Memory Search",
  name: "memory_search",
  description:
    "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
  parameters: MemorySearchSchema,
  execute: async (_toolCallId, params) => {
    const query = readStringParam(params, "query", { required: true });
    const results = await manager.search(query, { maxResults, minScore, sessionKey });
    return jsonResult({ results });
  },
};
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/tools/memory-tool.ts`

#### Online References
- Mem0 quickstart and API: https://docs.mem0.ai/platform/quickstart
- Mem0 add memories API: https://docs.mem0.ai/api-reference/memory/add-memories
- Zep memory retrieval docs: https://help.getzep.com/v2/memory

#### Definition of Done
- Existing memory recording behavior remains stable.
- Extended extraction writes structured assertions with provenance.

---

### WS-07: Implement Context Pruning Before Model Call (Gap #7a)

#### Problem
Large tool outputs can bloat context and degrade performance/cost.

#### Approach
Apply pre-send soft/hard pruning of old tool results while protecting recent assistant turns.

#### Atomic Tasks
1. Add context-pruning policy config (mode, thresholds, protected tail).
2. Implement soft-trim for oversized tool results.
3. Implement hard-clear placeholder when context pressure remains high.
4. Exclude image/tool outputs that should not be pruned.
5. Add token/char estimation telemetry for before/after pruning.
6. Add tests for safety invariants (never prune user text).

#### AModel Code Touchpoints
- New module under `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/context/`
- Runtime call site in `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/attempt-loop.ts`

#### OpenClaw Reference Snippet
```ts
export function pruneContextMessages(params: {
  messages: AgentMessage[];
  settings: EffectiveContextPruningSettings;
  ctx: Pick<ExtensionContext, "model">;
}) {
  const cutoffIndex = findAssistantCutoffIndex(messages, settings.keepLastAssistants);
  if (cutoffIndex === null) return messages;

  const firstUserIndex = findFirstUserIndex(messages);
  const pruneStartIndex = firstUserIndex === null ? messages.length : firstUserIndex;

  // soft trim then hard clear under pressure
  // ...
  return next ?? messages;
}
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/pi-extensions/context-pruning/pruner.ts`

#### Online References
- Session pruning concept (OpenClaw docs): https://docs.openclaw.ai/concepts/session-pruning
- LangGraph memory budgeting concepts: https://docs.langchain.com/oss/javascript/langgraph/memory

#### Definition of Done
- Context growth remains bounded under long-running tool-heavy sessions.
- No regressions in answer correctness for latest conversation turns.

---

### WS-08: Add Overflow Auto-Compaction + Retry (Gap #7b)

#### Problem
When context overflows, runtime should recover automatically, not just fail.

#### Approach
Detect overflow errors, compact session context, then retry once with compacted state.

#### Atomic Tasks
1. Normalize provider-specific overflow errors into one runtime error kind.
2. On overflow, trigger compaction pass.
3. Retry run after successful compaction.
4. Return clear user error if compaction fails or overflow repeats.
5. Add stream events and telemetry for compaction attempts/results.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/attempt-loop.ts`
- new compaction helper module under runtime context package

#### OpenClaw Reference Snippet
```ts
if (isContextOverflowError(errorText)) {
  const isCompactionFailure = isCompactionFailureError(errorText);
  if (!isCompactionFailure && !overflowCompactionAttempted) {
    overflowCompactionAttempted = true;
    const compactResult = await compactEmbeddedPiSessionDirect({...});
    if (compactResult.compacted) {
      continue; // retry prompt
    }
  }
  return {
    payloads: [{ text: "Context overflow: prompt too large for the model.", isError: true }],
  };
}
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run.ts`

#### Online References
- MemGPT (hierarchical/virtual context rationale): https://arxiv.org/abs/2310.08560
- ReAct (tool-action loop with control flow): https://arxiv.org/abs/2210.03629

#### Definition of Done
- At least one auto-recovery attempt on overflow.
- Overflow-related hard failures decrease measurably in telemetry.

---

### WS-09: Pre-Compaction Memory Flush (Gap #7c)

#### Problem
Important context can be lost before compaction if not persisted.

#### Approach
Run a silent memory flush turn near threshold; persist durable notes/facts before compaction.

#### Atomic Tasks
1. Add memory flush settings:
   - enable/disable
   - soft threshold
   - reserve tokens floor
   - prompt/system prompt
2. Inject `NO_REPLY` behavior for silent runs.
3. Ensure only one flush per compaction cycle.
4. Skip flush in read-only/sandbox-incompatible contexts.
5. Track metadata: `memoryFlushAt`, `memoryFlushCompactionCount`.

#### AModel Code Touchpoints
- runtime scheduler / pre-run housekeeping path
- session metadata store

#### OpenClaw Reference Snippets
```ts
export const DEFAULT_MEMORY_FLUSH_PROMPT = [
  "Pre-compaction memory flush.",
  "Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed).",
  `If nothing to store, reply with NO_REPLY.`,
].join(" ");
```

```ts
export function shouldRunMemoryFlush(params: {
  entry?: Pick<SessionEntry, "totalTokens" | "compactionCount" | "memoryFlushCompactionCount">;
  contextWindowTokens: number;
  reserveTokensFloor: number;
  softThresholdTokens: number;
}): boolean {
  const threshold = Math.max(0, contextWindow - reserveTokens - softThreshold);
  if (totalTokens < threshold) return false;
  if (lastFlushAt === compactionCount) return false;
  return true;
}
```
Sources:
- `/Users/dannywang/Projects/openclaw/src/auto-reply/reply/memory-flush.ts`
- `/Users/dannywang/Projects/openclaw/src/auto-reply/reply/agent-runner-memory.ts`

#### Online References
- OpenClaw compaction lifecycle doc: https://docs.openclaw.ai/reference/session-management-compaction
- Zep memory context usage: https://help.getzep.com/v2/memory

#### Definition of Done
- Flush runs before threshold crossing and updates session metadata.
- User-visible responses are not leaked from flush turns.

---

### WS-10: Build Episodic + Relationship Memory Model (Gap #8)

#### Problem
Flat fact memory is insufficient for CRM-like “who did I talk to, what did we discuss, what changed” queries.

#### Approach
Add first-class episodic and relationship memory entities with temporal validity.

#### Atomic Tasks
1. Add schema models:
   - `PersonEntity`
   - `InteractionEpisode`
   - `EpisodeParticipant`
   - `MemoryAssertion`
   - `MemoryEvidence`
   - `Commitment`
2. Link episodes to email threads, messages, and calendar events.
3. Add extraction pipeline to write episode summaries and commitments.
4. Add relationship edge updates with validity intervals.
5. Add contradiction handling (`active`, `superseded_by`, `invalidated_at`).

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/prisma/schema.prisma`
- new migration files under `/Users/dannywang/.codex/worktrees/f15f/amodel/prisma/migrations/`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/app/api/jobs/record-memory/route.ts`

#### OpenClaw Reference Snippet (conceptual source separation)
```ts
export type ResolvedMemorySearchConfig = {
  enabled: boolean;
  sources: Array<"memory" | "sessions">;
  // ...
  experimental: {
    sessionMemory: boolean;
  };
};
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/memory-search.ts`

#### Online References
- Zep key concepts: https://help.getzep.com/docs
- Graphiti (temporal KG framework): https://github.com/getzep/graphiti
- Zep paper: https://arxiv.org/abs/2501.13956
- A-MEM paper: https://arxiv.org/abs/2502.12110

#### Definition of Done
- “Have I spoken with X?” style queries return episodes + summaries + timestamps + evidence.

---

### WS-11: Retrieval Orchestrator for CRM-Style Queries (Gap #8 continuation)

#### Problem
Single-retriever approaches underperform on people/meeting/history questions.

#### Approach
Build multi-stage retrieval orchestration:
1. Structured filters first.
2. Hybrid text/vector retrieval second.
3. Temporal + relationship reranking third.
4. Confidence/citation output assembly last.

#### Atomic Tasks
1. Build query intent classifier for recall query types.
2. Add candidate generators:
   - person match
   - thread match
   - calendar match
   - episodic semantic search
3. Add fusion/reranker with configurable weights.
4. Add citation packaging for final responses.
5. Add confidence thresholds and fallback clarifying questions.

#### AModel Code Touchpoints
- new retrieval orchestrator module under memory feature
- call-sites in runtime response writer and memory tools

#### OpenClaw Reference Snippet (hybrid candidate retrieval flow)
```ts
const keywordResults = hybrid.enabled
  ? await this.searchKeyword(cleaned, candidates).catch(() => [])
  : [];

const queryVec = await this.embedQueryWithTimeout(cleaned);
const hasVector = queryVec.some((v) => v !== 0);
const vectorResults = hasVector
  ? await this.searchVector(queryVec, candidates).catch(() => [])
  : [];

const merged = this.mergeHybridResults({
  vector: vectorResults,
  keyword: keywordResults,
  vectorWeight: hybrid.vectorWeight,
  textWeight: hybrid.textWeight,
});
```
Source: `/Users/dannywang/Projects/openclaw/src/memory/manager.ts`

#### Online References
- Pinecone hybrid search: https://docs.pinecone.io/guides/search/hybrid-search
- Weaviate hybrid search: https://docs.weaviate.io/weaviate/search/hybrid
- Qdrant hybrid queries: https://qdrant.tech/documentation/concepts/hybrid-queries/
- Self-RAG: https://arxiv.org/abs/2310.11511

#### Definition of Done
- Recall queries improve on relevance/citation metrics in offline evals.

---

### WS-12: Context Budgeting and Slot Allocation

#### Problem
Without deterministic budget slots, context quality degrades unpredictably as sessions grow.

#### Approach
Use fixed context slot budgets by lane and degrade tier by tier.

#### Atomic Tasks
1. Define per-lane max context token shares.
2. Define slot priorities:
   - pending approvals/pending state
   - current request-linked entities
   - recent short-term history
   - high-confidence semantic memory
   - lower-priority long-tail snippets
3. Add truncation/compression rules per slot.
4. Add telemetry per slot size and drop reason.

#### AModel Code Touchpoints
- runtime routing + prompt composition modules
- context manager options (`contextTier`)

#### OpenClaw Reference Snippet (context window guard pattern)
```ts
export const CONTEXT_WINDOW_HARD_MIN_TOKENS = 16_000;
export const CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32_000;

export function evaluateContextWindowGuard(params: {
  info: ContextWindowInfo;
  warnBelowTokens?: number;
  hardMinTokens?: number;
}) {
  const warnBelow = Math.max(1, Math.floor(params.warnBelowTokens ?? CONTEXT_WINDOW_WARN_BELOW_TOKENS));
  const hardMin = Math.max(1, Math.floor(params.hardMinTokens ?? CONTEXT_WINDOW_HARD_MIN_TOKENS));
  const tokens = Math.max(0, Math.floor(params.info.tokens));
  return {
    ...params.info,
    tokens,
    shouldWarn: tokens > 0 && tokens < warnBelow,
    shouldBlock: tokens > 0 && tokens < hardMin,
  };
}
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/context-window-guard.ts`

#### Online References
- LangGraph memory architecture (short/long-term): https://docs.langchain.com/oss/javascript/langgraph/memory
- MemGPT context hierarchy: https://arxiv.org/abs/2310.08560

#### Definition of Done
- Context slot budget visible in logs/debug endpoint.
- Runtime remains stable under extended sessions.

---

### WS-13: Build Eval Harness + Release Gates (Gap #9)

#### Problem
No reliable way to prove that memory/context changes improved UX and did not regress execution safety.

#### Approach
Build offline + online eval suite with hard launch gates.

#### Atomic Tasks
1. Create eval datasets for:
   - person/interaction recall
   - thread continuity
   - meeting prep
   - commitment tracking
2. Add automated scoring:
   - retrieval precision@k / recall@k
   - groundedness/citation validity
   - contradiction rate
   - latency/token cost
   - action correctness and approval burden
3. Add canary rollout scoring dashboards.
4. Add launch gates tied to SLO thresholds.

#### AModel Code Touchpoints
- `/Users/dannywang/.codex/worktrees/f15f/amodel/tests`
- `/Users/dannywang/.codex/worktrees/f15f/amodel/src/server/features/ai/runtime/telemetry/`
- new eval config under `vitest.evals.config.ts` extensions or dedicated harness

#### OpenClaw Reference Snippet (observability focus from status/context philosophy)
```md
- `/status` → quick “how full is my window?” view + session settings.
- `/context list` → what’s injected + rough sizes (per file + totals).
- `/context detail` → deeper breakdown.
```
Source: `/Users/dannywang/Projects/openclaw/docs/concepts/context.md`

#### Online References
- LangGraph memory conceptual guidance: https://docs.langchain.com/oss/python/concepts/memory
- GraphRAG and HippoRAG evaluations:
  - https://arxiv.org/abs/2404.16130
  - https://arxiv.org/abs/2405.14831

#### Definition of Done
- Shipping requires pass on predefined memory + execution SLOs.

---

### WS-14: Governance, Privacy, and Data Lifecycle

#### Problem
Memory systems for personal assistant use-cases are high-risk without strict governance.

#### Approach
Define lifecycle controls for storage, retention, deletion, encryption, and scoped recall.

#### Atomic Tasks
1. Separate memory classes with retention defaults:
   - ephemeral execution context
   - user semantic facts
   - episodic interaction summaries
2. Add user controls:
   - forget by person/topic/date range
   - export memory report
   - audit memory accesses
3. Enforce embedding redaction for sensitive values.
4. Add tenant/user isolation tests.

#### AModel Code Touchpoints
- privacy settings, memory APIs, embedding pipelines

#### OpenClaw Reference Snippet (memory files as explicit trust boundary)
```md
Session logs live on disk (`~/.openclaw/agents/<agentId>/sessions/*.jsonl`).
Any process/user with filesystem access can read them, so treat disk access as the trust boundary.
```
Source: `/Users/dannywang/Projects/openclaw/docs/concepts/memory.md`

#### Online References
- LangGraph data storage/privacy: https://docs.langchain.com/langgraph-platform/data-storage-and-privacy
- Zep memory integration pattern: https://help.getzep.com/v2/memory

#### Definition of Done
- Policy-compliant memory lifecycle is test-covered and user-controllable.

---

## 5. Program Timeline (Suggested)

### Phase 0 (Week 1)
- Architecture contract freeze.
- Context slot schema and telemetry schema freeze.

### Phase 1 (Weeks 2-3)
- WS-01 + WS-02

### Phase 2 (Weeks 4-5)
- WS-03 + WS-04

### Phase 3 (Weeks 6-8)
- WS-05 + WS-10 + WS-11

### Phase 4 (Weeks 9-10)
- WS-07 + WS-08 + WS-09 + WS-12

### Phase 5 (Weeks 11-12)
- WS-13 + WS-14

### Phase 6 (Weeks 13-16)
- Canary rollout + SLO gate enforcement + production hardening

---

## 6. PR/Implementation Rules for This Program

### Problem
Without strict implementation rules, memory/context changes can drift from intended architecture.

### Approach
Enforce code + documentation + reference discipline in every PR.

### Mandatory Rules
1. Every PR must include:
   - Problem statement
   - chosen approach
   - alternatives considered
   - online references used
2. Every PR must include file-level tests and telemetry checks.
3. Every runtime behavior change must include rollback plan.
4. Any external algorithmic behavior copied/adapted from OpenClaw must include source path reference in code comments.
5. Do not ship memory mutation behavior without policy guard coverage.

### Reference Discipline
Use official docs and papers as implementation source-of-truth:
- LangGraph docs: https://docs.langchain.com/oss/javascript/langgraph/add-memory
- LlamaIndex docs: https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/
- Letta docs: https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- Pinecone docs: https://docs.pinecone.io/guides/search/hybrid-search
- Weaviate docs: https://docs.weaviate.io/weaviate/search/hybrid
- Qdrant docs: https://qdrant.tech/documentation/concepts/hybrid-queries/
- Zep docs: https://help.getzep.com/v2/memory
- Mem0 docs: https://docs.mem0.ai/platform/quickstart

---

## 7. Appendix: Additional OpenClaw Snippets to Port/Adapt

### A. Hybrid retrieval config normalization
```ts
const hybrid = {
  enabled: overrides?.query?.hybrid?.enabled ?? defaults?.query?.hybrid?.enabled ?? true,
  vectorWeight: overrides?.query?.hybrid?.vectorWeight ?? defaults?.query?.hybrid?.vectorWeight ?? 0.7,
  textWeight: overrides?.query?.hybrid?.textWeight ?? defaults?.query?.hybrid?.textWeight ?? 0.3,
  candidateMultiplier: overrides?.query?.hybrid?.candidateMultiplier ?? defaults?.query?.hybrid?.candidateMultiplier ?? 4,
};
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/memory-search.ts`

### B. Memory schema bootstrap
```ts
params.db.exec(`
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'memory',
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    hash TEXT NOT NULL,
    model TEXT NOT NULL,
    text TEXT NOT NULL,
    embedding TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
```
Source: `/Users/dannywang/Projects/openclaw/src/memory/memory-schema.ts`

### C. Memory tool contract
```ts
name: "memory_get",
description:
  "Safe snippet read from MEMORY.md, memory/*.md, or configured memorySearch.extraPaths with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
```
Source: `/Users/dannywang/Projects/openclaw/src/agents/tools/memory-tool.ts`

---

## 8. Final Success Criteria

1. User can ask: “Have I talked to this person before?” and get correct, grounded, cited answer.
2. User can ask: “What did we last discuss in email/meeting?” and get precise summary + dates.
3. Assistant continues to execute inbox/calendar tasks safely and correctly.
4. Long-running sessions remain stable and cost-efficient due to pruning/compaction controls.
5. All rollout gates pass (memory relevance, groundedness, contradiction rate, latency, action safety).
