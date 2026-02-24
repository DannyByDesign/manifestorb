# AI Inbox/Calendar Reliability Follow-up Backlog (Executable)

Date: 2026-02-24
Status: Open
Primary plan:
- `docs/plans/2026-02-24-ai-inbox-calendar-agent-reliability-implementation-plan.md`

## How to use this file

1. Execute work packages in order.
2. Do not mark a package complete unless its acceptance criteria and tests pass.
3. Keep this file updated with status and blockers for handoff.

## Work Package Tracker

Legend: `OPEN`, `IN_PROGRESS`, `BLOCKED`, `DONE`

1. WP-00 Baseline reproducibility tests
   - Status: DONE
   - Covers: baseline failing tests for all P0/P1 gaps
2. WP-01 P0 action correctness fixes
   - Status: DONE
   - Covers: move false-success, recurring single-instance target, calendar 410 canonical replay
3. WP-02 Mutation outcome contract hardening
   - Status: DONE
   - Covers: partial failure reporting for bulk email mutations
4. WP-03 Approval mapping and expiry hardening
   - Status: DONE
   - Covers: trash approval parity, expired approval rejection
5. WP-04 Multi-account deterministic routing
   - Status: DONE
   - Covers: wrong-account prevention and explicit disambiguation
6. WP-05 Sync/backfill reliability under load
   - Status: DONE
   - Covers: Gmail 404 backfill, calendar sync token race guard
7. WP-06 Idempotency and duplicate-action controls
   - Status: DONE
   - Covers: send/create/update/delete retry safety
8. WP-07 Scheduling queue transactional safety
   - Status: DONE
   - Covers: orphaned pending schedule states
9. WP-08 Temporal/routing/evidence consolidation
   - Status: DONE
   - Covers: previous-audit orchestration gaps
10. WP-09 Contract cleanup and missing capability completion
   - Status: DONE
   - Covers: `sendOnApproval` drift, restore/untrash capability
11. WP-10 Final hardening and rollout docs
   - Status: OPEN
   - Covers: architecture runbook, full verification gates

## Critical Priority View

### P0
1. Gmail move operation must never report success when unsupported.
2. Recurring single-instance calendar operations must target explicit instance identity.
3. Calendar 410 sync recovery must run canonical reconciliation replay.

### P1
1. Partial failures in bulk email mutations must be explicit and structured.
2. Trash/delete approval policy mapping must be consistent and non-bypassable.
3. Expired approvals must be non-executable.
4. Multi-account ambiguity must be clarified before inbox/calendar actions.
5. Gmail invalid history id path must trigger backfill.
6. Calendar sync token updates must be monotonic under concurrency.
7. Scheduling publish failures must transition rows to deterministic failed status.
8. Missing restore/untrash capability must be implemented.

## Exit Condition

Close this follow-up only when:
1. All WP-01 through WP-10 are `DONE`.
2. Full acceptance criteria in the plan doc are satisfied.
3. Reliability gates pass:
   - `bun run lint`
   - `bun run test`
   - `bun run test:e2e`
