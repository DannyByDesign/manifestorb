# Codebase Audit Follow-ups (Post Unified Search)

Date: 2026-02-17  
Status: Open

## Scope
Follow-ups found during the end-to-end architecture audit after unified-search rollout.

## Follow-up items
1. [closed] Remove disconnected legacy memory toolpack module (`src/server/features/ai/memory-tools.ts`) and update docs that still reference it (`src/server/features/memory/ARCHITECTURE.md`, `src/server/features/memory/embeddings/README.md`).
2. [open] Resolve unused legacy calendar provider factory (`src/server/features/calendar/providers/microsoft.ts`) or rewire callers if still required.
3. [closed] Define lint strategy and baseline cleanup plan. Current global lint gate fails with large pre-existing debt (hundreds of `no-explicit-any` and other violations), so CI signal is noisy for incremental runtime/search work.
4. [open] Add drift-repair integration test for `Knowledge.userId` hardening path (migration + predeploy script) to ensure future schema drift cannot silently pass migrate status and fail runtime checks.

## Notes
- Runtime/search regression checks are passing for the patched paths (calendar timezone handling, unified date-range matching, conversation-only routing test coverage).
- Production deploy safety was hardened with migration `prisma/migrations/20260217032000_harden_knowledge_userid_invariant/migration.sql`.
- Item 1 landed by deleting `src/server/features/ai/memory-tools.ts` and rewiring memory docs to runtime tool capability files.
- Item 3 landed with:
  - `bun run lint:changed` (strict lint gate for diff-only files),
  - `bun run lint:critical` (strict lint gate for unified search + runtime search/memory toolchain),
  - `bun run lint:baseline` (non-blocking full-repo debt report to `artifacts/lint/eslint-baseline.json`),
  - and cleanup roadmap in `docs/plans/2026-02-18-lint-strategy-baseline-plan.md`.
