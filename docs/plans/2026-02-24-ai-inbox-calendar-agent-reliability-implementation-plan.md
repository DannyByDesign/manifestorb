# AI Inbox + Calendar Agent Reliability Implementation Plan (Executable)

Date: 2026-02-24
Status: Ready for execution
Audience: Fresh engineer/AI agent with zero prior context
Scope: Inbox + calendar agent reliability end-to-end (read, write, sync, approval, routing, retries)

## 1) Mission and Definition of Done

Build a trustworthy inbox/calendar agent that is correct under normal use and reliable under retries, load, sync-token invalidation, and ambiguous user input.

Done means all of the following are true:
1. Every mutating inbox/calendar action is truthful, deterministic, and test-covered.
2. Wrong-account and wrong-instance (recurrence) actions are prevented by design.
3. Sync-token invalidation paths perform replay-safe full recovery with no silent drift.
4. Approval gating is consistent, non-bypassable, and auditable across all mutating tools.
5. Factual inbox/calendar answers are evidence-first; no unsupported certainty.

## 2) Source Documentation (Primary References)

### Google API correctness references
1. Gmail filtering/search (date literal PST caveat, epoch seconds guidance):
   - https://developers.google.com/workspace/gmail/api/guides/filtering
2. Gmail messages.list reference:
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
3. Gmail sync guidance (404 invalid history id => full sync):
   - https://developers.google.com/workspace/gmail/api/guides/sync
4. Gmail users.history.list reference (startHistoryId validity, 404 behavior):
   - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
5. Calendar events.list syncToken rules and incompatible params:
   - https://developers.google.com/workspace/calendar/api/v3/reference/events/list
6. Calendar incremental sync + 410 full resync requirement:
   - https://developers.google.com/workspace/calendar/api/guides/sync
7. Calendar recurring events and exception handling:
   - https://developers.google.com/workspace/calendar/api/guides/recurringevents
8. Calendar errors guide (410 fullSyncRequired, 409 conflict retry guidance):
   - https://developers.google.com/workspace/calendar/api/guides/errors
9. Calendar event model (`originalStartTime`, canceled exceptions semantics):
   - https://developers.google.com/workspace/calendar/api/v3/reference/events

### Agent/tool-calling reliability references
1. OpenAI function calling guide:
   - https://developers.openai.com/api/docs/guides/function-calling
2. OpenAI structured outputs:
   - https://developers.openai.com/api/docs/guides/structured-outputs
3. OpenAI agent safety guidance:
   - https://developers.openai.com/api/docs/guides/agent-builder-safety
4. Anthropic tool use implementation guidance:
   - https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
5. Anthropic context engineering guidance:
   - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents/
6. Gemini function calling guide:
   - https://ai.google.dev/gemini-api/docs/function-calling

## 3) Consolidated Problem Catalog (Previous + Latest Audit)

Severity: P0 critical trust/correctness break, P1 high reliability risk, P2 medium gap.

### P0
1. P0-EMAIL-MOVE-FALSE-SUCCESS
   - Problem: Gmail move-to-folder is unsupported but agent reports success.
   - Evidence:
     - `src/server/features/ai/tools/runtime/capabilities/email.ts` (`moveThread` returns success)
     - `src/server/features/email/providers/google.ts` (`moveThreadToFolder` no-op warning)
2. P0-CALENDAR-RECURRING-SINGLE-TARGET
   - Problem: Single-instance recurring update/delete uses first-upcoming instance heuristic.
   - Evidence:
     - `src/server/integrations/google/calendar.ts` (`events.instances` + `maxResults: 1` for update/delete)
3. P0-CALENDAR-410-CANONICAL-DRIFT
   - Problem: Calendar 410 recovery resets token but skips canonical shadow reconciliation.
   - Evidence:
     - `src/server/features/calendar/sync/google.ts` (normal canonical upsert/delete path vs 410 branch)

### P1
1. P1-EMAIL-PARTIAL-FAILURE-MASKED
   - Problem: Bulk modify logs item-level failures but returns top-level success.
   - Evidence: `src/server/features/ai/tools/providers/email.ts`
2. P1-TRASH-APPROVAL-MAPPING-GAP
   - Problem: `email.batchTrash` mapped to `delete_email` semantics, allowing conditional approval mismatch.
   - Evidence:
     - `src/server/features/ai/tools/runtime/capabilities/registry.ts`
     - `src/server/features/approvals/rules.ts`
3. P1-EXPIRED-APPROVAL-HONORED
   - Problem: Expired approval requests can still be decided and executed.
   - Evidence:
     - `src/server/features/approvals/service.ts`
     - `src/server/features/approvals/service.test.ts`
4. P1-MULTI-ACCOUNT-IMPLICIT-SELECTION
   - Problem: Most-recent account chosen without deterministic user disambiguation.
   - Evidence:
     - `src/server/lib/user-utils.ts`
     - `src/server/features/channels/router.ts`
5. P1-GMAIL-404-NO-BACKFILL
   - Problem: Expired history id path advances pointer without mandatory full sync/backfill.
   - Evidence: `src/server/features/email/process-history.ts`
6. P1-CALENDAR-SYNC-TOKEN-RACE
   - Problem: Sync token writes are not monotonic/guarded under concurrency.
   - Evidence: `src/server/features/calendar/sync/google.ts`
7. P1-SCHEDULE-SEND-ORPHAN-PENDING
   - Problem: `scheduleSend` writes pending row before publish; publish failure leaves ambiguous state.
   - Evidence: `src/server/features/ai/tools/runtime/capabilities/email.ts`
8. P1-RESTORE-CAPABILITY-MISSING
   - Problem: No restore/untrash capability in runtime surface.
   - Evidence: `src/server/features/ai/tools/runtime/capabilities/registry.ts`, `.../email.ts`
9. P1-IDEMPOTENCY-GAPS-MUTATIONS
   - Problem: Send/create/update/delete paths do not have consistent idempotency guarantees.
   - Evidence: runtime email/calendar mutation capability paths
10. P1-TOOL-ROUTING-DEGRADES
   - Problem: Prior audit showed tool admission collapse (`conversation_only`) and routing over-pruning for valid domain reads.
   - Evidence:
     - `src/server/features/ai/runtime/turn-contract.ts`
     - `src/server/features/ai/runtime/turn-planner.ts`
     - `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
11. P1-TEMPORAL-NORMALIZATION-FRAGMENTATION
   - Problem: Temporal parsing/normalization remains distributed and brittle across capabilities.
   - Evidence:
     - `src/server/features/ai/tools/timezone.ts`
     - `src/server/features/ai/tools/calendar-time.ts`
     - `src/server/features/ai/tools/runtime/capabilities/email.ts`
     - `src/server/features/ai/tools/runtime/capabilities/calendar.ts`
12. P1-EVIDENCE-AND-CLARIFICATION-POLICY-DRIFT
   - Problem: Clarification/error paths still risk weak deterministic behavior in edge retries/context degradation.
   - Evidence:
     - `src/server/features/ai/runtime/attempt-loop.ts`
     - `src/server/features/ai/runtime/response-writer.ts`

### P2
1. P2-SEND-ON-APPROVAL-CONTRACT-DRIFT
   - Problem: `sendOnApproval` accepted in schema/executor but ignored in draft capability behavior.
   - Evidence:
     - `src/server/features/ai/tools/runtime/capabilities/registry.ts`
     - `src/server/features/ai/tools/runtime/capabilities/executors/email.ts`
     - `src/server/features/ai/tools/runtime/capabilities/email.ts`
2. P2-SEMANTIC-FAMILY-PRUNING
   - Problem: `general + read` mapping can prune inbox/calendar tools to web-only families.
   - Evidence: `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
3. P2-MUTATION-TEST-COVERAGE-INCOMPLETE
   - Problem: Existing tests are strong on search/timezone but sparse on mutation/retry/partial-failure edges.

## 4) Target Reliability Architecture (Best-Practice Aligned)

This implementation adopts these architecture rules:

1. Strict schema-first tool contracts.
   - Use strict JSON schemas for tool calls (OpenAI/Anthropic/Gemini guidance).
   - Reject ambiguous or invalid args before side effects.

2. Deterministic tool execution state machine.
   - `allow | block | require_approval` must resolve before execution.
   - Mutations return structured outcome (`success`, `partial`, or `failed`) with per-item detail.

3. Approval as a first-class workflow.
   - Every mutating op has one canonical approval operation mapping.
   - Expired approvals are non-executable.
   - Approval decisions and execution logs are auditable and replay-safe.

4. Stable identity for high-risk targets.
   - Account identity must be explicit or deterministically resolved.
   - Recurring instance identity must use `instanceId` or `originalStartTime`, never first-upcoming heuristic.

5. Replay-safe sync pipeline.
   - Token invalidation triggers full replay/backfill with canonical state reconciliation.
   - Token pointers are monotonic under concurrency.

6. Evidence-first response policy.
   - Inbox/calendar factual answers require successful tool evidence or explicit uncertainty.
   - Clarification only for true ambiguity/missing identity.

## 5) Full Capability Matrix and Required Behavior

### Inbox operations
1. Send: exactly-once semantics under retries, explicit failure surface.
2. Draft create/update/delete: deterministic lifecycle; no dead fields in contract.
3. Reply/forward: correct parent targeting; no duplicate sends under retries.
4. Archive/label/read-unread/trash/move: truthful per-item mutation outcomes; unsupported ops must fail explicitly.
5. Restore/untrash: explicit recovery capability with approval policy.

### Calendar operations
1. Create/update/delete/reschedule: deterministic account+calendar+event identity.
2. Recurring operations: explicit single-instance identity via instance semantics.
3. Recurrence exception handling: moved/canceled instance safety.
4. Timezone and DST correctness at boundaries.

### Cross-cutting reliability
1. Retries/idempotency: all mutating paths are replay-safe.
2. Duplicates/race conditions: no stale token overwrite, no duplicate side effects.
3. Partial failures: caller receives structured per-item results and retry guidance.
4. Approval policy consistency: no bypass via operation mapping drift.

## 6) Work Packages (Executable Sequence)

Execute in order. Do not skip baselines.

### WP-00: Baseline tests and reproducibility harness

Goal: Establish failing tests for all audited gaps before code changes.

Files to add/update:
1. `src/server/features/ai/tools/runtime/capabilities/email.mutation.reliability.test.ts`
2. `src/server/features/ai/tools/runtime/capabilities/calendar.mutation.reliability.test.ts`
3. `src/server/features/calendar/sync/google.test.ts`
4. `src/server/features/email/process-history.test.ts`
5. `src/server/features/approvals/service.test.ts`

Tasks:
1. Add tests that reproduce each P0 and P1 problem.
2. Mark expected failures clearly in test names/messages.

Exit criteria:
1. All known gaps are represented by failing tests on current behavior.

### WP-01: Fix P0 action correctness defects

Goal: Remove immediate trust-breaking behavior.

Files:
1. `src/server/features/ai/tools/runtime/capabilities/email.ts`
2. `src/server/features/email/providers/google.ts`
3. `src/server/integrations/google/calendar.ts`
4. `src/server/features/calendar/sync/google.ts`

Tasks:
1. `email.moveThread`: return explicit unsupported error for Gmail provider.
2. Recurring single-instance update/delete: require explicit instance identity and remove first-upcoming fallback.
3. Calendar 410 recovery: run same canonical reconciliation logic as normal sync path.

Exit criteria:
1. P0 tests pass.
2. No mutating action returns success on unsupported/no-op behavior.

### WP-02: Mutation outcome contract hardening

Goal: Structured deterministic mutation outcomes with partial failure support.

Files:
1. `src/server/features/ai/tools/providers/email.ts`
2. `src/server/features/ai/tools/runtime/capabilities/email.ts`
3. `src/server/features/ai/tools/contracts/tool-result.ts` (if needed)

Tasks:
1. Change bulk mutation return contract to include `succeededIds`, `failedIds`, `retriable`.
2. Set top-level success false (or partial) when any item fails.
3. Update capability responses/messages to reflect partial results.

Exit criteria:
1. Partial failures are never reported as full success.

### WP-03: Approval mapping and expiry hardening

Goal: Eliminate approval bypass and stale-approval execution.

Files:
1. `src/server/features/ai/tools/runtime/capabilities/registry.ts`
2. `src/server/features/approvals/rules.ts`
3. `src/server/features/approvals/service.ts`
4. `src/server/features/ai/policy/tool-targeting.ts`

Tasks:
1. Align trash operations to canonical approval op with always-approval behavior.
2. Add parity tests ensuring tool registry mapping and policy rules cannot drift.
3. Reject decisions on expired approval requests and mark as `EXPIRED`.

Exit criteria:
1. `email.batchTrash` always requires approval.
2. Expired approvals are non-executable.

### WP-04: Multi-account deterministic routing

Goal: Prevent wrong-account actions.

Files:
1. `src/server/lib/user-utils.ts`
2. `src/server/features/channels/router.ts`
3. `src/server/features/ai/runtime/session.ts`
4. conversation state persistence paths as needed

Tasks:
1. Introduce explicit account resolution policy for multi-account users.
2. Require clarification before inbox/calendar actions when account is ambiguous.
3. Persist account choice for conversation continuity.

Exit criteria:
1. Multi-account ambiguity never executes silently.

### WP-05: Sync and backfill reliability under load

Goal: Replay-safe Gmail/Calendar sync resilience.

Files:
1. `src/server/features/email/process-history.ts`
2. `src/server/features/calendar/sync/google.ts`

Tasks:
1. Gmail 404 expired history id: trigger full backfill workflow; do not advance pointer until completion.
2. Add monotonic/compare-and-set style guard for calendar sync token updates.
3. Keep canonical reconciliation idempotent across replay pages.

Exit criteria:
1. No silent drift on invalid token/history id.
2. Concurrent sync runs cannot regress stored tokens.

### WP-06: Idempotency and duplicate-action controls

Goal: Exactly-once behavior for side-effectful operations where feasible.

Files:
1. `src/server/features/ai/tools/runtime/capabilities/email.ts`
2. `src/server/features/ai/tools/runtime/capabilities/calendar.ts`
3. scheduler paths for draft send execution

Tasks:
1. Add idempotency keys for send/create/update/delete paths lacking them.
2. Ensure retries are safe after unknown timeout outcomes.
3. Add dedupe persistence checks around queue publish + execution.

Exit criteria:
1. Duplicate side effects are prevented or surfaced with deterministic conflict outcomes.

### WP-07: Scheduling queue transactional safety

Goal: Remove orphaned schedule state.

Files:
1. `src/server/features/ai/tools/runtime/capabilities/email.ts`
2. schedule execution worker/api route for scheduled sends

Tasks:
1. On publish failure, transition schedule row to explicit failed status.
2. Add reconciler for orphaned pending rows.
3. Return deterministic error payload with schedule id/status.

Exit criteria:
1. No ambiguous pending rows after publish failure.

### WP-08: Temporal + routing + evidence policy consolidation (previous audit carry-forward)

Goal: Close all unresolved previous-audit orchestration gaps.

Files:
1. `src/server/features/ai/runtime/temporal/normalize.ts` (new)
2. `src/server/features/ai/runtime/temporal/schema.ts` (new)
3. `src/server/features/ai/tools/runtime/capabilities/email.ts`
4. `src/server/features/ai/tools/runtime/capabilities/calendar.ts`
5. `src/server/features/ai/runtime/turn-planner.ts`
6. `src/server/features/ai/runtime/session.ts`
7. `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
8. `src/server/features/ai/runtime/attempt-loop.ts`
9. `src/server/features/ai/runtime/response-writer.ts`

Tasks:
1. Implement one canonical temporal normalization contract for inbox/calendar tools.
2. Remove keyword-only temporal inference paths in capabilities.
3. Harden routing so inbox/calendar factual reads cannot collapse to tool-less path.
4. Ensure clarification is ambiguity-only and cannot override successful evidence.

Exit criteria:
1. "today" and common natural phrasing resolve deterministically in user timezone.
2. Read turns that need tool evidence cannot complete without tool evidence or reusable prior evidence.

### WP-09: Contract cleanup and missing capability completion

Goal: Remove dead contract fields and complete action surface.

Files:
1. `src/server/features/ai/tools/runtime/capabilities/registry.ts`
2. `src/server/features/ai/tools/runtime/capabilities/executors/email.ts`
3. `src/server/features/ai/tools/runtime/capabilities/email.ts`

Tasks:
1. Implement `sendOnApproval` end-to-end or remove it from schema/executor.
2. Add `email.restore`/`email.untrash` capability and approval mapping.

Exit criteria:
1. No accepted input fields are behaviorally ignored.
2. Restore workflow is available and tested.

### WP-10: Final hardening, docs, and rollout

Goal: Production-safe rollout and handoff documentation.

Files:
1. `docs/architecture/ai-agent-inbox-calendar-reliability.md` (new)
2. update runbooks and internal migration notes

Tasks:
1. Document invariants, failure modes, retry/idempotency policy, and approval audit trail.
2. Add rollout flags for high-risk behavior changes if needed.
3. Run full test/lint/e2e gates.

Exit criteria:
1. Fresh engineer/AI agent can execute and verify system reliability from docs alone.

## 7) Test Plan (Mandatory)

### Unit tests
1. Tool schema validation, operation mapping parity, approval expiry, recurrence identity resolver.
2. Temporal normalization for natural-language ranges + timezone boundaries.

### Integration tests
1. End-to-end write flows with approval, retries, partial failures.
2. Multi-account disambiguation and persisted account selection.
3. Queue publish failure and reconciliation.

### Sync/replay tests
1. Gmail history 404 path triggers full backfill flow.
2. Calendar 410 path performs canonical replay and token refresh.
3. Concurrent sync workers preserve monotonic tokens.

### E2E critical flows
1. Inbox factual reads with time phrases (`today`, `this morning`, etc.).
2. Calendar recurrence exception updates/deletes.
3. Approval-required destructive actions.

## 8) Execution Commands for Implementing Agent

Run locally during each WP:
```bash
bun run lint
bun run test
```

Before final handoff:
```bash
bun run test:e2e
git pull --rebase
git push
git status
```

## 9) Fresh-Agent Runbook

1. Read this file and the follow-up issue file first.
2. Start at WP-00 and do not skip failing baseline tests.
3. Implement one WP per PR-sized change; keep tests in the same change.
4. For every changed behavior, update acceptance criteria evidence in PR notes.
5. If a WP cannot be completed, leave explicit blocker notes and failing test references.

## 10) Traceability: Problem to Work Package Mapping

1. P0-EMAIL-MOVE-FALSE-SUCCESS -> WP-01
2. P0-CALENDAR-RECURRING-SINGLE-TARGET -> WP-01
3. P0-CALENDAR-410-CANONICAL-DRIFT -> WP-01
4. P1-EMAIL-PARTIAL-FAILURE-MASKED -> WP-02
5. P1-TRASH-APPROVAL-MAPPING-GAP -> WP-03
6. P1-EXPIRED-APPROVAL-HONORED -> WP-03
7. P1-MULTI-ACCOUNT-IMPLICIT-SELECTION -> WP-04
8. P1-GMAIL-404-NO-BACKFILL -> WP-05
9. P1-CALENDAR-SYNC-TOKEN-RACE -> WP-05
10. P1-IDEMPOTENCY-GAPS-MUTATIONS -> WP-06
11. P1-SCHEDULE-SEND-ORPHAN-PENDING -> WP-07
12. P1-TOOL-ROUTING-DEGRADES -> WP-08
13. P1-TEMPORAL-NORMALIZATION-FRAGMENTATION -> WP-08
14. P1-EVIDENCE-AND-CLARIFICATION-POLICY-DRIFT -> WP-08
15. P1-RESTORE-CAPABILITY-MISSING -> WP-09
16. P2-SEND-ON-APPROVAL-CONTRACT-DRIFT -> WP-09
17. P2-SEMANTIC-FAMILY-PRUNING -> WP-08
18. P2-MUTATION-TEST-COVERAGE-INCOMPLETE -> WP-00, WP-10

## 11) Notes on Existing Strengths (Do Not Regress)

1. Runtime policy is enforced before tool execution (`mcp-tools` path).
2. Approval request creation already uses idempotency keys.
3. Gmail history pointer update includes monotonic protection logic.

Retain these behaviors while implementing the work packages.
