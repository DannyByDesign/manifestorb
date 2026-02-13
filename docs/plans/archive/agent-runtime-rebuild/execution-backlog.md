# Execution Backlog (Detailed)

Status: Ready for implementation

## Workstream A: Schema and contract stability

### A1. Schema registry bootstrap (Epic 01)

- Create provider-schema registry module.
- Register schemas for preflight, semantic parser, router, slots, planner.
- Add startup validator and fail-fast wiring.

### A2. Preflight schema migration (Epics 01, 02)

- Replace provider-facing preflight schema with transform-free type.
- Update preflight parser path to use DTO + mapper.
- Add branch telemetry for deterministic vs LLM preflight usage.

### A3. Semantic parser schema migration (Epics 01, 05)

- Replace broad union object values with bounded typed entities.
- Add parser output schema version tag.
- Implement parse DTO mapper and strict unknown-field handling.

### A4. Planner schema migration (Epics 01, 04)

- Replace open `args` schema with typed capability unions.
- Add capability args schema map.
- Wire plan validation to typed args map.

## Workstream B: Correctness for basic user requests

### B1. Direct read intent detection (Epic 03)

- Add deterministic patterns for first/latest/oldest/next factual queries.
- Insert route rule before planner fallback.
- Ensure unresolved ambiguous requests return clarifying prompt.

### B2. Direct read execution lane (Epic 03)

- Add execution mapping from read intent to narrow capabilities.
- Tune capability input limits and ordering semantics.
- Return typed answer envelope.

### B3. Response rendering split (Epic 07)

- Separate execution result objects from user-facing text rendering.
- Implement renderer v2 for direct-read, action summary, policy block, clarify.
- Keep debug-only path for internal step details.

## Workstream C: Latency and provider resilience

### C1. Gmail per-user concurrency guard (Epic 06)

- Add limiter around batch fetch and retries.
- Add anti-stampede jitter strategy for retries.

### C2. Progressive fetch (Epic 06)

- Metadata-first for read intent.
- Hydrate full message only for selected ids.
- Make broad fetch opt-in for complex requests.

### C3. Orchestration dedup (Epic 08)

- Introduce per-turn orchestration context object.
- Ensure parser runs once and output is reused.
- Gate broadened planner candidate selection.

## Workstream D: Guardrails and release

### D1. Policy enforcement unification (Epic 09)

- Align planner and skill policy decision input schema.
- Normalize transformed args and approval behavior.
- Standardize policy decision logging fields.

### D2. Release controls (Epic 10)

- Execute single hard cutover to rebuilt runtime path.
- Validate deployment-level rollback runbook (git/deploy revert only).

### D3. Legacy deletion sweep (Epic 10)

- Remove obsolete runtime branches and compatibility adapters.
- Remove dead config toggles and stale docs references.
- Verify build/import graph has no references to deleted modules.

## Delivery sequence (PR-level)

1. PR-01: A1 + A2
2. PR-02: A3
3. PR-03: A4
4. PR-04: B1 + B2
5. PR-05: B3
6. PR-06: C1 + C2
7. PR-07: C3
8. PR-08: D1
9. PR-09: D2

## Mandatory validation per PR

- Startup schema registry passes.
- No new provider schema warnings/errors for touched routes.
- Route-level manual smoke checks pass for impacted behavior.
