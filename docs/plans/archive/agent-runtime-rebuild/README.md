# Agent Runtime Rebuild Plan (Inbox + Calendar)

Status: Proposed for execution
Owner: AI runtime team
Last updated: 2026-02-13
Primary goal: ship a reliable assistant that can correctly answer basic inbox/calendar requests and safely execute complex autonomous actions with unified guardrails, while deleting obsolete legacy runtime paths.

## Why this plan exists

Recent production logs show three systemic failures:
1. Structured output schema incompatibilities with Gemini/Vertex.
2. Routing gaps for simple factual requests (for example: "first email in inbox").
3. Planner/executor UX mismatch where internal step logs are returned instead of user answers.

This plan converts those failures into a concrete implementation sequence with strict schema controls and deterministic execution boundaries.

## Plan package

- `schema-safety-spec.md`
- `epic-01-llm-schema-compatibility-hardening.md`
- `epic-02-deterministic-preflight-first.md`
- `epic-03-direct-read-intent-lane.md`
- `epic-04-planner-typed-args-refactor.md`
- `epic-05-semantic-parser-contract-simplification.md`
- `epic-06-gmail-throttling-and-progressive-fetch.md`
- `epic-07-user-response-contract-rewrite.md`
- `epic-08-orchestration-dedup-and-latency-reduction.md`
- `epic-09-policy-plane-enforcement-consolidation.md`
- `epic-10-rollout-and-cutover-controls.md`
- `legacy-deletion-checklist.md`

## Execution order (hard cutover)

1. Epic 01
2. Epic 02
3. Epic 03
4. Epic 07
5. Epic 04
6. Epic 05
7. Epic 06
8. Epic 08
9. Epic 09
10. Epic 10
11. Legacy deletion sweep

Rationale:
- Epics 01 and 02 remove schema breakage and preflight instability first.
- Epics 03 and 07 fix the end-user "basic request" failure path quickly.
- Epics 04 and 05 harden planner/parser contracts to prevent recurring schema failures.
- Epics 06 and 08 reduce latency and provider rate-limit pressure.
- Epics 09 and 10 finish guardrail consistency and clean cutover controls.
- Final sweep removes dead code and compatibility shims.

## Critical path and dependencies

- Epic 01 is a hard dependency for any path that calls `generateObject`.
- Epic 03 depends on Epic 01 and Epic 02.
- Epic 04 depends on Epic 01.
- Epic 05 depends on Epic 01.
- Epic 08 depends on Epics 02, 04, and 05.
- Epic 10 depends on all prior epics.

## Non-negotiable implementation constraints

1. No provider-facing schema may include transform logic.
2. No provider-facing schema may include open-ended object unions that compile to empty object `properties`.
3. All planner step args must be capability-typed and schema-validated before execution.
4. User-facing answers must never directly mirror raw internal step logs except explicit debug mode.
5. Every mutating operation must pass through policy decision point checks.
6. No legacy dual-path runtime is retained after cutover.
7. No compatibility shim is kept unless it is required for data migration only.

## Definition of done for the full plan

1. Basic factual prompts (for example: "what is the first email in my inbox") answer correctly in one turn.
2. No production logs containing structured output schema failures for preflight/parser/router/planner.
3. Planner path remains available for long-tail requests and no longer returns generic plan-build failure for supported operations.
4. Policy behavior is consistent across skills and planner paths.
5. Legacy runtime paths and obsolete adapters are deleted.
6. Schema startup checks are enabled for all provider-facing structured outputs.

## Working model for implementation

- Execute one epic at a time.
- For each epic, complete all acceptance criteria before moving to the next epic.
- Use the schema safety spec in every PR touching `generateObject` schemas.
- Default to hard replacement over layered fallback when editing runtime behavior.
