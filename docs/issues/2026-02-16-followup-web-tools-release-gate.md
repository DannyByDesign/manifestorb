# Issue: Web Tools Release Gate Follow-up

## Why
`web.search` and `web.fetch` are implemented and targeted test/lint gates pass, but `bun run build` is currently blocked by a pre-existing TypeScript error in `src/server/features/ai/tools/runtime/capabilities/email.ts` (line 519: `paging` typed as `Record<string, unknown> | undefined`, but `null` is assigned).

## Remaining Work
1. Fix the `paging` type mismatch in `src/server/features/ai/tools/runtime/capabilities/email.ts`.
2. Re-run `bun run build` and confirm the full production build succeeds.
3. Run the broader AI test suite (`bun test-ai`) once build is green.

## Acceptance
- `bun run build` exits successfully.
- No type regressions in runtime capabilities.
- Web tool changes remain green in targeted and broader suites.
