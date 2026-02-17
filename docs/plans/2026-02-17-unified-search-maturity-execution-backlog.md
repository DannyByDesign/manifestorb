# Unified Search Maturity Execution Backlog

Date: 2026-02-17  
Owner: Search + Runtime  
Status: Executed

## Goal
Ship a single search path with:
1. Continuously updated pre-indexed connector corpora.
2. Richer ranking signals (behavioral + graph + authority + intent + freshness).
3. Query understanding (rewrite/entity/alias/typo).
4. Reliability primitives appropriate for a personal AI secretary product.

## Constraints
1. Do not overbuild enterprise infra yet.
2. Keep architecture extensible for future connectors.
3. Remove duplicate active search logic.

## Epic 1: Corpus Foundation (Schema + Storage)
Status: Done

### PR-1.1 Search corpus schema
1. Add core tables:
   - `SearchDocument`
   - `SearchChunk`
   - `SearchEntity`
   - `SearchAlias`
   - `SearchEdge`
   - `SearchSignal`
   - `SearchIngestionCheckpoint`
2. Add indexes for:
   - identity (`userId`, `connector`, `sourceType`, `sourceId`)
   - recency/freshness (`updatedSourceAt`, `lastIngestedAt`)
   - connector filtering
3. Add PostgreSQL text indexes and vector-ready migration hooks.

Acceptance:
1. Migration applies cleanly on existing environments.
2. Corpus tables support all current surfaces.

### PR-1.2 Index repository and normalization contracts
1. Add indexed document contract types.
2. Add repository functions for upsert/delete/checkpoint/chunk writes.
3. Add deterministic chunking policy.

Acceptance:
1. A single function can upsert any surface document into corpus.

## Epic 2: Ingestion and Continuous Updates
Status: Done

### PR-2.1 Queue + worker for indexing
1. Add Redis-backed indexing queue with retries and stale-job recovery.
2. Add worker endpoint:
   - `/api/jobs/process-search-index`
3. Add queue metrics output (pending/processing/failed).

Acceptance:
1. Index jobs persist across failures and are replayable.

### PR-2.2 Email connector ingestion
1. Add email ingestor from parsed provider messages.
2. Hook into webhook/shared history processor.
3. Upsert/delete corpus docs based on message lifecycle.

Acceptance:
1. New inbound/sent messages appear in corpus without query-time fetch.

### PR-2.3 Calendar connector ingestion
1. Add calendar ingestor on canonical shadow upsert/delete.
2. Preserve identity remaps via iCalUid/external IDs.

Acceptance:
1. Calendar changes are reflected in corpus incrementally.

### PR-2.4 Rule connector ingestion
1. Add rule ingestor on create/update/disable/delete.
2. Store normalized rule text and metadata for retrieval.

Acceptance:
1. Rule edits immediately impact search results.

## Epic 3: Query Intelligence
Status: Done

### PR-3.1 Query rewrite and scope planning
1. Add rewrite stage for conversational phrasing.
2. Add surface scope planner with intent hints.

Acceptance:
1. Queries like “portfolio review I sent” map to sender/mailbox hints without hard failures.

### PR-3.2 Entity + alias + typo resolution
1. Add entity resolver for people, calendars, rule names.
2. Add alias expansion and typo normalization.

Acceptance:
1. Near-miss names and aliases resolve to intended entities.

## Epic 4: Retrieval and Ranking Maturity
Status: Done

### PR-4.1 Candidate generation from corpus
1. Replace query-time fanout as primary retrieval path.
2. Use lexical + semantic candidate generation over corpus.

Acceptance:
1. Unified search reads from corpus first.

### PR-4.2 Feature-based scoring
1. Add scoring features:
   - lexical relevance
   - semantic relevance
   - freshness by connector
   - authority
   - behavioral priors
   - graph proximity
   - intent-surface match
2. Add weighted fusion with stable tie-breakers.

Acceptance:
1. Score quality improves known-item recall and ranking order.

## Epic 5: Single Active Search Path (Legacy Cut)
Status: Done

### PR-5.1 Hard-cut retrieval ownership
1. Keep legacy tool names but delegate to unified corpus search.
2. Remove duplicate active search logic from provider-level paths.

Acceptance:
1. One active retrieval path in runtime.

## Epic 6: Reliability and Observability
Status: Done

### PR-6.1 Reliability controls
1. Add replay endpoint for failed index jobs.
2. Add ingestion lag measurement per connector.
3. Add source freshness health checks.

Acceptance:
1. Operators can detect and recover from ingestion drift quickly.

### PR-6.2 Search quality telemetry
1. Add query/result telemetry:
   - zero-result rate
   - top-k latency
   - candidate counts by connector
   - ranking mode and feature contributions

Acceptance:
1. Relevance and reliability regressions are observable.

## Epic 7: Validation Suite
Status: Done

### PR-7.1 Retrieval regression tests
1. Add tests for messy sent-mail lookups.
2. Add cross-surface queries (email + calendar + rules + memory).
3. Add alias/typo/entity tests.

Acceptance:
1. Prior failure mode (“known email exists but not found”) is covered.

## Deployment Sequence
1. PR-1.1
2. PR-1.2 + PR-2.1
3. PR-2.2 + PR-2.3 + PR-2.4
4. PR-3.x
5. PR-4.x
6. PR-5.x
7. PR-6.x + PR-7.x

## Current Execution Slice
Executed in this cycle:
1. Query-intelligence rewrite + mailbox/scope/entity-alias expansion.
2. Corpus-first hard cut for search retrieval (email/calendar/rule), with memory included.
3. Feature-based ranking with transparent score components.
4. Connector checkpoint reliability and queue replay/health controls.
5. Runtime policy target selection using unified search.
6. Deployment self-heal for `Knowledge.userId` drift.
