# Lint Strategy and Baseline Cleanup Plan

Date: 2026-02-18
Status: Active

## Problem
Global `eslint` currently fails on large pre-existing debt, which makes CI noisy and obscures regressions in newly-shipped runtime/search work.

## Strategy
Adopt a three-lane lint workflow:

1. `lint:changed` (strict, required for incremental work)
- Command: `bun run lint:changed`
- Scope: only changed JS/TS files compared to `origin/main` plus local staged/unstaged/untracked deltas.
- Policy: `--max-warnings=0`.
- Purpose: prevent new debt from entering touched code paths.

2. `lint:critical` (strict, required for search/runtime releases)
- Command: `bun run lint:critical`
- Scope:
  - `src/server/features/search/unified`
  - `src/server/features/search/index`
  - `src/server/features/ai/tools/runtime/capabilities/search.ts`
  - `src/server/features/ai/tools/runtime/capabilities/executors/search.ts`
  - `src/server/features/ai/tools/runtime/capabilities/memory.ts`
  - `src/server/features/ai/tools/runtime/capabilities/executors/memory.ts`
  - `src/server/features/ai/tools/runtime/capabilities/registry.ts`
- Policy: `--max-warnings=0`.
- Purpose: maintain hard guarantees for user-facing retrieval/tooling paths.

3. `lint:baseline` (non-blocking debt inventory)
- Command: `bun run lint:baseline`
- Output: `artifacts/lint/eslint-baseline.json`
- Purpose: snapshot and track debt burn-down trend without blocking feature delivery.

## Cleanup Execution Backlog
1. Baseline snapshot cadence
- Run `lint:baseline` at least once per sprint and attach count deltas in release notes/issues.

2. Rule-family burn-down order
- Wave A: `@typescript-eslint/no-explicit-any` in runtime/search/memory support modules.
- Wave B: unsafe null/unknown handling in infra modules (queueing, adapters, middleware).
- Wave C: remaining style/consistency warnings after type-safety cleanup.

3. Ratchet policy
- Never relax `lint:changed`/`lint:critical`.
- Expand `lint:critical` scope only after candidate paths are clean and stable for two releases.

## Exit Criteria
- `lint:changed` always green on active PRs.
- `lint:critical` always green on runtime/search release branches.
- Global lint debt trend from `lint:baseline` decreases sprint-over-sprint.
