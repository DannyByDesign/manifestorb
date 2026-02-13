# Epic 08: Orchestration Dedup and Latency Reduction

Status: Planned
Priority: P1
Depends on: Epics 02, 04, 05

## Objective

Remove redundant LLM calls and repeated semantic parsing across the same turn to cut latency and cost.

## Problem statement

Current flow repeats intent parsing and candidate selection across preflight, router, and planner paths, increasing latency for simple requests.

## In scope

- Introduce per-turn shared orchestration context.
- Parse once, reuse across router/planner.
- Limit broadened planner attempts to strict conditions.

## Out of scope

- Cross-turn memory redesign.
- Caching across users.

## Affected code

- `src/server/features/ai/message-processor.ts`
- `src/server/features/ai/planner/runtime.ts`
- `src/server/features/ai/planner/select-capabilities.ts`
- `src/server/features/ai/skills/runtime.ts`

## Implementation plan

### Step 1: Define `TurnOrchestrationContext`

Include:
- normalized message
- semantic parse output
- route decision
- candidate capability shortlist

### Step 2: Pass context through runtime layers

- message processor builds context once
- router and planner consume context directly

### Step 3: Gate broadened planner selection

Broaden only when:
- initial candidate set fails validation and
- unresolved critical entities remain

### Step 4: Add latency-stage telemetry

Emit durations for:
- preflight
- parse
- route
- plan build
- execution
- render

## Manual validation checklist

1. Trace one simple read prompt.
2. Confirm single semantic parse call per turn.
3. Confirm no unnecessary broadened planner attempt.

## Acceptance criteria

1. Reduced median and p95 latency for basic prompts.
2. Reduced LLM call count per turn.
3. No functional regression in route correctness.

## Risks and mitigations

- Risk: stale context reuse when continuation mutates intent.
- Mitigation: rebuild context on explicit continuation state transitions.

## Rollback plan

- Revert deployment/commit if shared orchestration context causes critical routing regressions.
