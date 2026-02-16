# Issue: Follow-up DB Rollout + Production Validation

## Why
The structured memory tables and lifecycle endpoints are implemented, but production rollout still requires environment-level validation.

## Remaining Work
1. Apply migrations in staging and production (`20260216100000_add_conversation_embedding_index`, `20260216140000_add_structured_memory_tables`).
2. Run `verify:embedding-contract:ci` against deployed databases.
3. Execute memory recall eval (`eval:memory-recall:ci`) on representative seeded users.
4. Verify dashboarding for new telemetry events (`openworld.runtime.context_pruned`, `openworld.runtime.compaction_retry`, `openworld.runtime.context_slots`).
5. Add end-to-end tests for `api/memory/export`, `api/memory/forget`, `api/memory/recall`.

## Acceptance
- All migrations applied successfully.
- Eval gates meet thresholds.
- No runtime regressions in inbox/calendar execution quality.
