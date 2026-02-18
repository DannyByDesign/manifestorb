# Deterministic Cross-Surface Executor: Expand Beyond XP Prompts

## Context
To reduce multi-step orchestration failures, we added a deterministic executor for a small set of cross-surface prompts (XP-002..XP-005 and day-plan prefetch).

File:
- `src/server/features/ai/runtime/deterministic-cross-surface.ts`

## Problem
- Coverage is narrow (string-match heuristics for a few prompts).
- Multi-turn workflow packs W1..W12 still rely on model step-chaining.

## Acceptance Criteria
- Replace XP string-matching with a scalable deterministic orchestration layer that:
  - Uses one model call to compile a strict JSON plan.
  - Executes the plan deterministically through the existing tool harness so policy enforcement and approvals remain intact.
  - Falls back to the native planner when the plan is invalid or tools are not admitted.
- Add unit tests proving:
  - The plan is executed sequentially via the harness.
  - The executor falls back safely when a tool is not available or args are invalid.

## Status
Implemented (2026-02-18).

## Implementation Notes
- `src/server/features/ai/runtime/deterministic-cross-surface.ts` now compiles a plan (JSON) and executes tool calls sequentially via `executeToolCall(...)`.
- Runtime tool gating is still enforced end-to-end:
  - Session-time allow/deny filtering remains in `src/server/features/ai/runtime/session.ts`.
  - Per-tool enforcement + approvals remain in `src/server/features/ai/tools/harness/tool-definition-adapter.ts` and policy enforcement.
- Planner lane tool catalog pruning is prevented from accidentally dropping required tools by setting `maxTools=96` for planner turns in `src/server/features/ai/runtime/session.ts`.
