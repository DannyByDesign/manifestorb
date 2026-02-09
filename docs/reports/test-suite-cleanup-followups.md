# Test Suite Cleanup Follow-ups (2026-02-09)

## Open Issues

1. Lint baseline failures (`@typescript-eslint/no-explicit-any`) across legacy API and test files.
- Status: Open
- Scope: `src/app/api/**`, `src/server/lib/**`, and several integration tests.
- Next step: add typed test factories and remove broad `any` usage incrementally.

2. Non-test TypeScript compile failures in active product code.
- Status: Open
- Scope: `src/server/features/ai/tools/create.ts`, DB extension typing, API payload typing.
- Next step: complete pending schema/type refactor and run full `bunx tsc --noEmit` gate.

3. Skipped integration scenario in `group-scheduling-nightmare.integration.test.ts` when `RUN_AI_TESTS` is not enabled.
- Status: Open
- Scope: keep as conditional integration test or convert to deterministic mock-based integration.
- Next step: decide expected CI behavior and either always-enable with mocks or move to eval/nightly.
