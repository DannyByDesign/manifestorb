# Runtime Cutover Checklist

## Scope
Final production cutover checklist for the OpenClaw-style runtime.

## Mandatory Gates

- [x] Single runtime path in `message-processor` (no legacy planner/preflight branch)
- [x] Legacy `features/rules` runtime stack removed
- [x] Rule plane is mandatory PDP for mutating tool calls
- [x] Tool fabric assembly is dynamic and pack-based
- [x] Runtime planner has deterministic validation + one repair pass
- [x] High-confidence direct read lane implemented
- [x] Root `skills/` artifacts migrated into in-repo runtime catalog under `src/server/features/ai/skills/catalog`
- [x] Build gate: `bunx tsc --noEmit` green
- [x] Runtime/webhook/reply-tracker regression tests green

## Operational Readiness Gates

- [x] Per-user runtime concurrency limiter active
- [x] Shared retry/backoff utilities for provider operations active
- [x] Structured runtime telemetry schema present and enforced at emit-time
- [x] Runtime telemetry event set covers planning, direct-read, precheck-failure, clarification, completion
- [x] Provider retry and retry-exhaustion logs emitted with structured fields

## Rollout Sequence

1. Deploy runtime branch to staging.
2. Validate inbox read/write and calendar read/write smoke suite.
3. Validate approval-required actions through rule plane.
4. Validate webhook ingestion under provider throttling.
5. Promote to production.

## Rollback Trigger

Rollback if any of the following is sustained for 15 minutes:

- `openworld.turn.completed.failed / openworld.turn.completed.stepCount > 0.2`
- provider 429 retry exhaustion > 5% of tool calls
- median runtime response latency > agreed threshold
