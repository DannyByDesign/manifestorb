# Unified Search Retrofit Plan (Atomic, Hard-Cut)

Date: 2026-02-17  
Owner: Runtime + Search Platform

## Objective
Replace fragmented, surface-specific retrieval logic with a single unified search layer across:
1. Email (all mailbox areas)
2. Calendar (all selected/connected calendars)
3. Rule Plane (canonical rules)
4. Memory/Knowledge (facts, knowledge, conversation history)

This is a hard cut architecture change. Legacy search paths are removed from the execution path (kept only as backward-compatible tool names that delegate into unified search).

## Why this fixes the root cause
The current failure mode (known term in sent mail not found) comes from fragmented query construction + strict/heuristic filters + provider-specific syntax drift.  
Unified Search removes this by:
1. Running federated retrieval across all applicable surfaces
2. Applying consistent hybrid ranking (lexical + semantic rerank)
3. Returning ranked evidence with surface-level transparency
4. Avoiding strict sender-only filter rejection in normal read/search flows

## Glean-inspired architectural patterns we are adopting
1. Federated connectors with normalized documents
2. Query understanding + expansion + intent-aware scope selection
3. Hybrid retrieval + unified ranking layer
4. ACL-safe source filtering at retrieval time
5. Extensible connector contract for future systems

## Current code touchpoints (observed)
1. Runtime orchestration: `src/server/features/ai/runtime/*`
2. Tool registry + executors: `src/server/features/ai/tools/runtime/capabilities/*`
3. Email search path:
   - `src/server/features/ai/tools/runtime/capabilities/email.ts`
   - `src/server/features/ai/tools/providers/email.ts`
   - `src/server/features/ai/tools/runtime/capabilities/validators/email-search.ts`
4. Calendar search path:
   - `src/server/features/ai/tools/runtime/capabilities/calendar.ts`
   - `src/server/features/ai/tools/providers/calendar.ts`
5. Rule matching path:
   - `src/server/features/ai/tools/runtime/capabilities/policy.ts`
   - `src/server/features/policy-plane/service.ts`
6. Existing semantic/hybrid primitives:
   - `src/server/features/memory/embeddings/search.ts`
   - `src/server/features/memory/retrieval/orchestrator.ts`

## Implementation Phases

## Phase 0: Contract and schema correctness (precondition)
Goal: eliminate deploy/runtime drift before search cutover.

### 0.1 Knowledge ownership contract lock
Files:
1. `prisma/schema.prisma`
2. `prisma/migrations/<new>/migration.sql`
3. `scripts/prisma-migrate-deploy.sh`

Atomic actions:
1. Ensure `Knowledge.userId` exists and is backfilled from `EmailAccount.userId` when absent.
2. Keep `Knowledge.emailAccountId` nullable compatibility path.
3. Add deterministic migration for add/backfill/index/fk.
4. Keep predeploy checks compatible with either ownership path during transition.

Acceptance:
1. `prisma migrate deploy` succeeds on environments that only had `emailAccountId`.
2. No `Knowledge.userId` missing-column runtime errors.

## Phase 1: Build unified search core (new module)
Goal: one service API used by all runtime search callers.

### 1.1 Create normalized unified search domain
Files (new):
1. `src/server/features/search/unified/types.ts`
2. `src/server/features/search/unified/query.ts`
3. `src/server/features/search/unified/ranking.ts`
4. `src/server/features/search/unified/service.ts`

Atomic actions:
1. Define canonical request shape (`query`, `scopes`, `mailbox`, `dateRange`, `limit`, `fetchAll`, `attendee`, `sender`, etc.).
2. Define canonical result item shape (surface, id, title, snippet, timestamp, score, evidence).
3. Implement surface adapters:
   - email adapter
   - calendar adapter
   - rule adapter
   - memory adapter
4. Implement hybrid ranker:
   - lexical scoring (token overlap + phrase boost)
   - semantic scoring when embedding service is available
   - normalized final score + stable tie-breaks (recency, source weight)
5. Add hard limits and timeout budgets per surface + global budget.

Acceptance:
1. Unified service returns mixed surface results sorted by one ranking function.
2. No surface-specific assumptions leak into caller.

## Phase 2: Runtime tool integration (hard cut)
Goal: search tools route into unified service.

### 2.1 Add unified runtime capability
Files:
1. `src/server/features/ai/tools/runtime/capabilities/search.ts` (new)
2. `src/server/features/ai/tools/runtime/capabilities/index.ts`
3. `src/server/features/ai/tools/runtime/capabilities/registry.ts`
4. `src/server/features/ai/tools/runtime/capabilities/executors/search.ts` (new)
5. `src/server/features/ai/tools/runtime/capabilities/executors/index.ts`

Atomic actions:
1. Add `search.query` capability and schema.
2. Register executor and include in runtime executor map.
3. Add capability family metadata/tags/effects for policy and routing.

Acceptance:
1. Planner can call `search.query`.
2. Tool schema passes provider safety checks.

### 2.2 Delegate existing search tools into unified core
Files:
1. `src/server/features/ai/tools/runtime/capabilities/email.ts`
2. `src/server/features/ai/tools/runtime/capabilities/calendar.ts`
3. `src/server/features/ai/tools/runtime/capabilities/policy.ts`

Atomic actions:
1. Keep tool names for compatibility (`email.searchInbox`, `email.searchSent`, etc.) but make them wrappers over unified service.
2. Calendar list/search delegate to unified service calendar scope.
3. Rule target lookup uses unified rule search candidates before LLM tie-breaker.

Acceptance:
1. Legacy tool names still function, but logic is centralized in unified service.
2. Surface-specific strict filters no longer own retrieval quality.

## Phase 3: Remove strict/fragile filter behavior from read/search path
Goal: eliminate false negatives from over-strict heuristics.

### 3.1 Email validator downgrade from reject -> sanitize
Files:
1. `src/server/features/ai/tools/runtime/capabilities/validators/email-search.ts`
2. `src/server/features/ai/tools/runtime/capabilities/validators/email-search.test.ts`

Atomic actions:
1. Stop hard-failing sender-like phrases that look like metadata.
2. Keep normalization (trim, temporal suffix stripping) without blocking the query.
3. Add tests proving sanitization but not rejection.

Acceptance:
1. Read/search requests are never rejected solely by sender phrase heuristics.

## Phase 4: Policy, routing, and toolpack alignment
Goal: make unified search first-class in allowlists and runtime routing.

Files:
1. `src/server/features/ai/tools/policy/tool-policy.ts`
2. `src/server/features/ai/tools/fabric/policy-filter.ts` (if group changes required)
3. `src/server/features/ai/runtime/turn-compiler.ts`
4. `src/server/features/ai/runtime/router.ts` (if route hints updated)

Atomic actions:
1. Add `search.query` into relevant read groups (`group:inbox_read`, `group:calendar_read`, optional new `group:search`).
2. Update compiler allowlist for single-tool read lookups to use unified tool when confidence is high.
3. Keep planner fallback for ambiguity.

Acceptance:
1. Search-related intents can resolve via unified search in both single-tool and planner lanes.

## Phase 5: API surface for product/UI and future connectors
Goal: expose unified search outside chat runtime.

Files:
1. `src/app/api/search/unified/route.ts` (new)
2. Optional: `src/app/api/search/unified/route.test.ts` (new)

Atomic actions:
1. Add authenticated API endpoint using same unified service.
2. Return consistent result schema and per-surface counts.
3. Reuse ACL checks from runtime context.

Acceptance:
1. UI and external flows can consume unified search without duplicating logic.

## Phase 6: Legacy removal and dead-path cleanup
Goal: hard-cut old retrieval paths from active search logic.

Files:
1. `src/server/features/ai/tools/providers/email.ts` (remove local filter ownership from top-level behavior)
2. `src/server/features/ai/tools/providers/calendar.ts` (remove final lexical-only gate from primary search path)
3. test/docs references across `docs/AI_INBOX_CALENDAR_RULES_TEST_QUESTION_BANK.md` and runtime tests

Atomic actions:
1. Mark old local-filter logic as secondary fallback only where unavoidable.
2. Move primary ranking responsibility to unified service.
3. Update tests/docs to expect unified behavior.

Acceptance:
1. No active runtime search path bypasses unified service for read/search semantics.

## Phase 7: Observability and quality gates
Goal: detect drift and keep quality high.

Files:
1. `src/server/features/ai/runtime/telemetry/schema.ts`
2. `src/server/features/search/unified/*` (emit events)
3. Existing test suites + new tests

Atomic actions:
1. Emit telemetry:
   - query scope selection
   - candidate counts per surface
   - ranker mode (lexical/semantic/hybrid)
   - zero-result events
2. Add test matrix:
   - known sent item retrieval (messy description)
   - cross-calendar natural language retrieval
   - rule lookup by paraphrase
   - mixed-surface query returns ranked heterogeneous results

Acceptance:
1. Regression tests guard known failure modes.
2. Telemetry provides root-cause visibility for misses.

## Phase 8: Extensibility contract for future surfaces
Goal: add new systems without architecture changes.

Files:
1. `src/server/features/search/unified/types.ts`
2. `src/server/features/search/unified/service.ts`
3. `src/server/features/search/unified/adapters/*` (future)

Atomic actions:
1. Define adapter interface for any new connector:
   - `retrieveCandidates`
   - `normalizeDocument`
   - `buildAclFilter`
2. Keep all ranking in shared core.
3. Add source weighting config by adapter.

Acceptance:
1. New data source can be onboarded by implementing one adapter.

## Non-goals in this cut
1. Replacing provider APIs with full external index infra in one release.
2. Implementing multi-tenant offline reindex workers for every surface before runtime cutover.

## Rollout strategy
1. Ship unified service + compatibility wrappers.
2. Validate with targeted sent-search and cross-surface tests.
3. Remove dead branches and old assumptions in follow-up cleanup PR if needed.

## Definition of Done
1. All runtime/search read flows use unified retrieval core.
2. Sent/inbox/calendar/rule/memory retrieval works with messy human phrasing.
3. Deploy succeeds with schema guardrails.
4. Tests pass and telemetry confirms hybrid retrieval path execution.
