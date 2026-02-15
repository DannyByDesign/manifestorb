# Issue: Fast-Path Coverage Plan Implementation

## Context

The new fast-path source-of-truth plan is documented in:
- `docs/plans/2026-02-15-fast-path-coverage-source-of-truth.md`

This issue tracks code implementation work needed to execute that plan.

## Scope

Implement phases 1-6 from the plan:

1. Semantic-first candidateing (confidence + margin).
2. Operation-catalog fast-path matcher (replace regex-primary chain).
3. Accuracy/completeness hardening for count/list operations.
4. Router/SLA budget alignment for fast-path latency.
5. Matrix-backed tests for all covered operations.
6. Fast-path observability and fallback telemetry.

## Required Outcomes

- Fast path covers the defined high-frequency request matrix with correctness-first behavior.
- Rule fast path does not require human-provided rule IDs.
- Incomplete count results never produce definitive count claims.
- Planner fallback remains automatic when fast path is ineligible.
- Test coverage reflects the coverage matrix and guards regressions.

## Notes

- Keep assistant tone natural and non-templated.
- Preserve embedding-first semantic classification and deterministic policy gating.
