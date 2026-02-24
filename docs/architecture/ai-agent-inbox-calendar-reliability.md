# AI Inbox/Calendar Reliability Architecture

Date: 2026-02-24  
Status: Active baseline

## Scope

This document defines the production reliability contract for inbox/calendar runtime behavior:

1. Deterministic mutation execution under retries/timeouts.
2. Explicit failure and partial-failure reporting.
3. Wrong-account/wrong-instance mutation prevention.
4. Replay-safe sync invalidation recovery.
5. Evidence-first factual response behavior.
6. Approval policy consistency and auditable execution.

## Core Invariants

### Mutations and Idempotency

1. Side-effectful runtime mutations (`email.send*`, `email.createDraft`, `email.updateDraft`, `email.deleteDraft`, `email.reply`, `email.forward`, `calendar.createEvent`, `calendar.updateEvent`, `calendar.deleteEvent`) use persistent idempotency claims.
2. Duplicate retries return deterministic replay payloads; they do not re-execute provider side effects.
3. Schedule-send requests use deterministic idempotency keys (`draftId + notBefore`) and reuse existing schedule rows when duplicates arrive.

### Scheduling Queue Safety

1. Schedule-send publish failures transition persisted rows to `FAILED` and return deterministic `{scheduleId, status}` error payloads.
2. QStash execute path processes by `scheduleId` with row-level status lock (`PENDING/FAILED -> SENDING`) to prevent duplicate send execution.
3. Jobs reconciler marks orphaned stale pending rows (`scheduledId = null`, overdue) as `FAILED`.

### Identity Safety

1. Multi-account ambiguity for inbox/calendar actions requires explicit user clarification before tool execution.
2. Recurring single-instance calendar mutations require explicit `instanceId` or `originalStartTime`.
3. Unsupported provider mutations (for example Gmail folder move) fail explicitly and never return false success.

### Sync Replay Safety

1. Gmail history 404 invalidation triggers full replay/backfill before pointer advance.
2. Calendar sync 410 recovery runs canonical reconciliation path.
3. Calendar token writes are monotonic/CAS-protected to prevent stale overwrite under concurrency.

### Evidence and Clarification

1. Inbox/calendar factual read turns cannot complete without fresh tool evidence or reusable prior evidence.
2. Clarification cannot override successful evidence in the same turn.
3. Temporal phrases (`today`, `this morning`, `this week`, `next week`) are normalized through one shared runtime temporal contract in user timezone.

### Approval Consistency

1. Registry approval operations and policy rules must stay in parity (tested).
2. Expired approvals are non-executable and are marked `EXPIRED`.
3. `email.batchTrash` and `email.restore` map to explicit destructive/recovery operations with approval evaluation.

## Structured Mutation Outcomes

Bulk email mutations must return:

1. `success` (false when any item fails).
2. `count`, `succeededIds`, `failedIds`, `retriable`.
3. A user-facing message that accurately reflects partial/full failures.

## Failure Modes and Recovery

### Provider/API Failure

1. Capability returns structured failure (`error`, `message`, optional `clarification`).
2. For schedule-send publish failure, persisted state is updated to `FAILED`.
3. For sync token/history invalidation, full replay path is used instead of pointer-only advance.

### Timeout/Unknown Outcome

1. Idempotency replay records prevent duplicate mutation execution on retried calls.
2. Duplicate in-flight requests return deterministic in-progress conflict payload.

### Partial Failures

1. Per-item outcomes are surfaced; caller can retry only failed/retriable IDs.

## Approval Audit Trail

The policy/approval system provides traceability through:

1. Decision context normalization (`operation`, `resource`, `itemCount`, recipients).
2. Approval requests with deterministic idempotency keys.
3. Decision and execution logging with correlation metadata.
4. Expiry enforcement on `decideRequest`.

## Rollout and Gating

No additional runtime feature flags were introduced in this pass. Rollout guardrail is test-gated deployment only.

Required gates before deploy:

1. `bun run lint`
2. `bun run test` (or `bun run test-ai` when `test` script is not defined)
3. `bun run test:e2e`

Operational checks after deploy:

1. Verify no sustained growth in `scheduledDraftSend` rows stuck in `PENDING`/`SENDING`.
2. Verify approval decisions for `trash_email` and `restore_email` appear with expected tool mappings.
3. Verify runtime factual read responses include tool evidence for inbox/calendar turns.

## Handoff Checklist

1. Read plan + follow-up tracker documents.
2. Validate tracker statuses against latest commits.
3. Re-run lint/test/e2e gates.
4. Confirm branch is rebased and pushed.
