# Follow-up Issues: Regex-Authority Removal

Date: 2026-02-24

## Open Issue 1
Title: Replace heuristic step-budget classifier with model-planned execution budget

- Current status: open
- Why: `src/server/features/ai/step-budget.ts` is still heuristic-driven and not wired to planner outputs.
- Target: derive `maxSteps` from structured turn planner output and policy constraints only.

## Open Issue 2
Title: Expand no-regex authority gate coverage to additional orchestration surfaces

- Current status: open
- Why: no-regex gate currently protects the highest-risk authority files only.
- Target: incrementally include remaining runtime and policy orchestration files after cleanup.

## Open Issue 3
Title: Add offline backfill command invocation to migrate canonical rules from regex ops

- Current status: open
- Why: migration script exists but has not been executed against production data.
- Target: run `scripts/migrate-canonical-rule-regex-operators.ts --apply` in controlled env and verify results.

## Open Issue 4
Title: Add eval suite for planner accuracy and tool-evidence guarantees

- Current status: open
- Why: new model planner + pending decision extractor need regression coverage for ambiguous phrases.
- Target: add eval fixtures covering unread/today, approvals, slot selection, and ambiguous-time resolutions.
