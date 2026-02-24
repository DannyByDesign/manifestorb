# Reliability Gate Blockers (Post WP-10)

Date: 2026-02-24  
Status: OPEN

## Context

The inbox/calendar reliability implementation (`WP-00` through `WP-10`) is complete, but repository-wide verification gates are blocked by pre-existing project issues outside the reliability package scope.

## Blockers

1. Lint gate fails (`bun run lint`)
   - Scope: large pre-existing backlog across generated/build artifacts and legacy source/tests.
   - Representative hotspots:
     - `landing/.next/**` generated bundles being linted.
     - Legacy `no-explicit-any` violations across `src/server/lib/**`, `src/server/features/**`, and integration tests.

2. Test script contract mismatch (`bun run test`)
   - `package.json` does not define a `test` script.
   - Bun falls back to `/bin/test` and exits non-zero.

3. Full unit/integration suite (`bun run test-ai`) still fails on unrelated suites
   - Missing module import paths in legacy tests:
     - `tests/integration/channels/notifications-fallback.integration.test.ts`
     - `src/server/features/email/error-handling.test.ts`
     - `src/server/features/email/thread-context.test.ts`
     - `src/app/api/google/webhook/process-history-item.test.ts`
   - Unrelated proactive notification expectation drift:
     - `src/server/features/ai/proactive/orchestrator.test.ts`

4. E2E gate (`bun run test:e2e`) fails on unresolved import
   - `tests/e2e/nothing-else-matters.test.ts` imports missing `@/features/rules/ai/prompts/prompt-to-rules`.

## Suggested Next Actions

1. Define a canonical `test` script in `package.json` (or align gate commands to `test-ai`).
2. Exclude generated artifacts from lint input (or fix lint config root globs).
3. Restore/migrate missing import targets used by legacy suites.
4. Re-baseline unrelated failing suites before enforcing global gate as release blocker.
