# 2026-02-24 AI Inbox/Calendar Reliability Follow-ups

## Context

Tracking issue for follow-up implementation work captured in:
- `docs/plans/2026-02-24-ai-inbox-calendar-agent-reliability-implementation-plan.md`

## Priority Work Items

## P0 (Must fix first)

1. Fix false-success `email.moveThread` behavior on Gmail (unsupported operation currently reported as success).
2. Replace recurring single-instance update/delete "first upcoming instance" heuristic with explicit instance targeting.
3. Apply canonical replay reconciliation in calendar 410 sync-token recovery path.

## P1 (High)

1. Surface partial failures in bulk email mutations (`archive`, `trash`, `read/unread`, labels) instead of returning `success: true`.
2. Align `email.batchTrash` approval mapping/rules so destructive trash is always approval-gated.
3. Enforce hard expiry for approval decisions (expired approvals cannot execute).
4. Implement deterministic multi-account selection/disambiguation before inbox/calendar read/write.
5. Add `email.restore`/`email.untrash` capability for reversibility.
6. Add Gmail expired-history backfill flow instead of pointer-advance-only behavior.
7. Add calendar sync-token concurrency guard to prevent stale token overwrite under load.
8. Add idempotency guarantees for send/create/update/delete retry paths to prevent duplicate actions.
9. Make `email.scheduleSend` publish failures transition scheduled rows to deterministic failed state.

## P2 (Medium)

1. Resolve `sendOnApproval` contract drift (implement end-to-end or remove from schema/executor).
2. Broaden semantic tool admission fallback when planner domain is misclassified (`general + read` should not prune inbox/calendar tools).
3. Expand mutation-focused reliability tests across inbox/calendar capability surface (including recurrence exceptions and DST boundaries).

## Test Workstream Requirements

1. Add mutation reliability tests for every inbox/calendar mutating capability.
2. Add recurrence exception tests: moved instances, canceled instances, DST transitions.
3. Add sync recovery tests: Gmail expired history backfill, calendar 410 canonical replay, calendar sync-token race.
4. Add approval tests for stale approvals and operation-mapping parity.
5. Add multi-account disambiguation tests for both read and mutate turns.

## Exit Condition

Close this issue when all P0 and P1 items are shipped and validated, and all plan acceptance criteria in:
- `docs/plans/2026-02-24-ai-inbox-calendar-agent-reliability-implementation-plan.md`
are passing.
