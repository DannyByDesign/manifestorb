# Deterministic Cross-Surface Executor: Expand Beyond XP Prompts

## Context
To reduce multi-step orchestration failures, we added a deterministic executor for a small set of cross-surface prompts (XP-002..XP-005 and day-plan prefetch).

File:
- `src/server/features/ai/runtime/deterministic-cross-surface.ts`

## Problem
- Coverage is narrow (string-match heuristics for a few prompts).
- Multi-turn workflow packs W1..W12 still rely on model step-chaining.

## Acceptance Criteria
- Expand deterministic executor to cover:
  - IM-020 ("Move all invoices into Finance folder and mark read")
  - CM-007 ("Move my 1:1 ... to earliest free slot tomorrow afternoon")
  - CM-020 ("Find a free slot and move event <event-id> there automatically")
  - CR-011 (overlaps/conflicts)
- Ensure policy enforcement and approvals are preserved (via tool harness execution).
- Add unit tests that prove deterministic executor fires for these prompt patterns.
