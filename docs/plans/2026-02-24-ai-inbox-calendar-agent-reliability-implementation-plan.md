# AI Inbox + Calendar Agent Reliability Implementation Plan (Handoff-Ready)

**Date:** 2026-02-24  
**Status:** Ready for implementation  
**Audience:** Any engineer/AI agent taking over with zero prior context  
**Scope:** `src/server/features/ai/**/*`, Gmail/Calendar providers, runtime routing/tooling, tests  
**Explicit exclusion:** Net-new observability workstream is intentionally excluded per product direction.

## 1. Problem Statement

The current agent fails basic natural-language requests like:
- "Do I have any unread emails from today?"

Observed behavior includes:
1. Asking clarification for "today" even though the phrase is unambiguous.
2. Sometimes returning incorrect unread counts for "today".
3. Sometimes routing into a conversation-only path that strips tool access.

This is not a model-intelligence problem. It is an orchestration and contract problem across routing, tool admission, temporal normalization, and tool error handling.

## 2. Why This Is a Critical Product Problem

1. It breaks trust on a core use case (inbox awareness).
2. It causes false confidence or unnecessary clarifications for simple requests.
3. It signals architecture drift: logic split across brittle heuristics + fallback branches instead of a single robust "language -> normalized intent -> tool call -> evidence" pipeline.
4. It will recur in adjacent requests (calendar date ranges, follow-ups, scheduling windows, time-zone-sensitive summaries).

## 3. Required User Experience After Fix

For end users, the system must behave as follows:

1. "Today" is always understood without clarification.
2. Any natural phrasing of date/time range is handled (examples: "today", "this morning", "after lunch", "since yesterday evening", "in the last 2 hours").
3. If date intent is truly ambiguous, the assistant asks one precise follow-up question and explains what is missing.
4. Unread-count answers are grounded in tool evidence, not free-form model guesses.
5. Time interpretation follows the user/account timezone by default; responses are consistent at day boundaries.
6. If a tool call fails, the assistant retries or degrades gracefully and does not claim certainty without evidence.

## 4. External Documentation (Source Links)

### Google Gmail / Calendar (official)

1. Gmail search/filtering and date semantics (`q` behavior, PST warning for date literals):  
   https://developers.google.com/workspace/gmail/api/guides/filtering
2. Gmail `users.messages.list` reference (`q`, `labelIds`, `includeSpamTrash`):  
   https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
3. Gmail list-messages guide (query/filter usage):  
   https://developers.google.com/workspace/gmail/api/guides/list-messages
4. Calendar `events.list` reference (`timeMin`, `timeMax`, `syncToken`, incompatible params):  
   https://developers.google.com/workspace/calendar/api/v3/reference/events/list
5. Calendar incremental sync guide (`nextSyncToken`, `410 GONE`):  
   https://developers.google.com/workspace/calendar/api/guides/sync

### Agent/tool architecture best practices

1. Gemini function-calling best practices (clear schemas, validation, finish reason checks):  
   https://ai.google.dev/gemini-api/docs/function-calling
2. OpenAI function-calling guide (strict schemas, fewer tools, strong descriptions):  
   https://platform.openai.com/docs/guides/function-calling
3. Anthropic tool-use implementation guidance:  
   https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
4. Anthropic context engineering for agents:  
   https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents/

## 5. Current Codebase Findings (Root Causes)

## F1. Routing can remove tools entirely for valid user asks

Evidence:
- `src/server/features/ai/runtime/turn-contract.ts`
- `src/server/features/ai/runtime/turn-planner.ts`
- logs showing `toolCountAfter: 0`, `routeHint: "conversation_only"`

Impact:
- Agent cannot call inbox/calendar tools for valid read requests.

## F2. Intent-to-capability mapping is too narrow

Evidence:
- `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`

Impact:
- `general + read` can map to web intent family and miss inbox/calendar tool set.

## F3. Temporal handling is fragmented and partially regex/keyword-driven

Evidence:
- `src/server/features/ai/tools/timezone.ts`
- `src/server/features/ai/tools/calendar-time.ts`
- `src/server/features/ai/tools/runtime/capabilities/calendar.ts`

Impact:
- Inconsistent behavior across tools and phrasing variants.

## F4. `email.countUnread` has brittle parameter normalization and error path

Evidence:
- `src/server/features/ai/tools/runtime/capabilities/email.ts`
- tool failures in logs followed by clarification despite eventual successful retry

Impact:
- First call fails, then model asks clarification or stops early.

## F5. Evidence gating is weak

Evidence:
- `src/server/features/ai/runtime/attempt-loop.ts`

Impact:
- System may generate user-facing text without strict successful-evidence gating.

## F6. Two-hop model generation adds failure modes

Evidence:
- `src/server/features/ai/runtime/response-writer.ts`

Impact:
- Clarification text can be introduced by response-writer behavior even when tool evidence exists.

## F7. Context hydration timeout degrades planning quality

Evidence:
- `src/server/features/ai/runtime/context/retrieval-broker.ts`
- `src/server/features/ai/runtime/context/hydrator.ts`

Impact:
- Requests can proceed with degraded context and poor tool routing.

## F8. Gmail query semantics are easy to misuse for date ranges

Evidence:
- Gmail docs: date literals interpreted at PST midnight unless epoch seconds are used.

Impact:
- "Today" queries can be wrong in non-PST zones if query uses date strings instead of epoch boundaries.

## 6. Architecture Requirements for the Fix

1. Single canonical temporal normalization interface for all inbox/calendar tools.
2. Tool contracts use strict JSON schema and typed arguments.
3. Runtime never answers mailbox/calendar factual questions without evidence from successful tool calls.
4. Router must preserve domain tools for domain asks.
5. Clarification only when required fields are truly ambiguous after normalization.
6. Retry/error policy should be deterministic and bounded.

## 7. Implementation Workstreams

## WS0. Reproduction Harness and Baseline

Objective:
- Create deterministic failing test coverage before changing behavior.

File targets:
- `tests/e2e/critical-e2e-slack-google-tier*.test.ts`
- `tests/e2e/live-google-flow.test.ts`
- add focused tests under `tests/e2e/` and `tests/unit/` where appropriate

Tasks:
1. Add failing tests for unread-from-today phrasing variants.
2. Add tests for ambiguous vs non-ambiguous time phrases.
3. Add regression case that fails if route becomes `conversation_only` for inbox/calendar read asks.

Exit criteria:
1. Tests fail on current code for known broken behavior.
2. Baseline failure artifacts are captured in test output.

## WS1. Canonical Temporal Normalization Service

Objective:
- Replace scattered parser behavior with one shared service.

Create:
- `src/server/features/ai/runtime/temporal/normalize.ts`
- `src/server/features/ai/runtime/temporal/schema.ts`

Contract (example):
```ts
export type TemporalNormalizationResult = {
  status: "resolved" | "ambiguous" | "invalid";
  timezone: string;
  rangeStartIso?: string;
  rangeEndIso?: string;
  needsClarification?: string;
  confidence: number;
};
```

Tasks:
1. Input: raw user phrase + reference timestamp + user timezone.
2. Output: normalized `[start,end)` ISO range + confidence + clarification reason when needed.
3. Support natural language broadly; do not rely on hardcoded keyword-only matching.
4. Keep deterministic guardrails: if parser/model output invalid, return structured `ambiguous` or `invalid`, never silent fallback.

Notes:
- Model-assisted normalization is allowed, but the output must conform to strict schema and be validated.
- Deterministic fallback should handle explicit ISO and RFC3339 inputs.

Exit criteria:
1. All tools consume this service (email + calendar).
2. "today" always resolves in account timezone.

## WS2. Remove Keyword-Coupled Date Extraction in Capabilities

Objective:
- Eliminate duplicate regex keyword extraction paths.

File targets:
- `src/server/features/ai/tools/calendar-time.ts`
- `src/server/features/ai/tools/runtime/capabilities/calendar.ts`
- `src/server/features/ai/tools/runtime/capabilities/email.ts`

Tasks:
1. Remove hardcoded keyword-trigger logic from capability-level request parsing.
2. Route all temporal resolution through WS1 service.
3. Keep feature behavior identical for explicit ISO ranges while expanding natural language reliability.

Exit criteria:
1. No capability performs independent keyword-only temporal inference.
2. Temporal behavior is consistent between email and calendar tools.

## WS3. Routing and Tool Admission Hardening

Objective:
- Prevent tool catalog collapse for valid inbox/calendar queries.

File targets:
- `src/server/features/ai/runtime/turn-contract.ts`
- `src/server/features/ai/runtime/turn-planner.ts`
- `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
- `src/server/features/ai/runtime/session.ts` (if tool prefix admission participates)

Tasks:
1. Ensure read intents containing inbox/calendar entities keep inbox/calendar tool families admitted.
2. Remove/adjust fallback that forces `conversation_only` for these requests.
3. Add planner guard: if user asks inbox/calendar factual query, disallow no-tool plan unless explicit reason is present.

Exit criteria:
1. Requests like "Do I have unread emails today?" always have `email.countUnread` available.
2. Routing tests assert non-zero relevant tools.

## WS4. `email.countUnread` Contract and Execution Reliability

Objective:
- Make unread counting robust and schema-first.

File targets:
- `src/server/features/ai/tools/runtime/capabilities/email.ts`
- `src/server/features/ai/tools/runtime/capabilities/registry.ts`

Tasks:
1. Update tool schema to accept a normalized temporal range object.
2. Validate range before provider call; return structured error object when invalid.
3. Add deterministic retry policy for transient provider/tool failures.
4. Ensure returned payload clearly marks `success`, `count`, `appliedFilters`, `timezone`.

Exit criteria:
1. No free-form parse errors leak to model.
2. Tool either returns structured success evidence or structured actionable error.

## WS5. Gmail Query Construction Correctness

Objective:
- Build Gmail query ranges that are timezone-correct and API-compatible.

File targets:
- `src/server/features/email/providers/google.ts`

Tasks:
1. Convert normalized range boundaries to epoch seconds for Gmail `after:`/`before:` filters.
2. Preserve unread semantics using `is:unread` and explicit scope strategy.
3. Keep `includeSpamTrash` behavior explicit and configurable by tool input.
4. Document query construction rules inline with links to Gmail filtering docs.

Why:
- Gmail docs specify date literals are interpreted at PST midnight; epoch seconds avoid timezone drift.

Exit criteria:
1. "today" unread count is correct across non-PST user timezones.
2. Provider unit tests validate generated `q` strings.

## WS6. Clarification Policy Rewrite

Objective:
- Clarify only on genuine ambiguity.

File targets:
- `src/server/features/ai/runtime/attempt-loop.ts`
- `src/server/features/ai/runtime/response-writer.ts`

Tasks:
1. Add policy: for common relative expressions (`today`, `tomorrow`, `yesterday`, "this morning", "tonight"), clarification is disallowed when timezone is known.
2. If tool evidence exists, response-writer cannot override to "needs clarification".
3. If first tool call fails and second succeeds, final response must use success evidence.

Exit criteria:
1. Repro logs no longer show `stopReason: needs_clarification` for "today".
2. Clarification appears only for true ambiguity.

## WS7. Context Degradation Safety

Objective:
- Avoid degraded-context behavior that harms deterministic tool routing.

File targets:
- `src/server/features/ai/runtime/context/retrieval-broker.ts`
- `src/server/features/ai/runtime/context/hydrator.ts`
- `src/server/features/ai/runtime/turn-planner.ts`

Tasks:
1. If targeted context hydration times out, keep minimal deterministic domain-routing signals.
2. Prevent timeout degradation from dropping tool families.
3. Add fallback path that preserves domain question -> domain tools mapping even with bootstrap context only.

Exit criteria:
1. Context timeout does not cause `conversation_only` for inbox/calendar factual asks.

## WS8. Test Coverage Expansion (Must Pass)

Objective:
- Lock in reliability.

Add tests for:
1. "today" unread count (simple phrasing).
2. Equivalent phrasings: "from today", "since midnight", "this morning".
3. Boundary times around local midnight.
4. Non-PST timezone users.
5. First-call tool failure + retry + successful final response.
6. Calendar parity phrases using same normalization path.

Exit criteria:
1. Unit, integration, and targeted e2e tests pass.
2. No regressions in existing Slack/Google critical suites.

## WS9. Cleanup and Contract Documentation

Objective:
- Make architecture maintainable for future contributors/agents.

File targets:
- `docs/architecture/` (new or existing runtime contract doc)
- tool registry docs/comments where relevant

Tasks:
1. Document canonical temporal contract and forbidden anti-patterns.
2. Document clarification rules and evidence-first response policy.
3. Add "do not add keyword-only temporal parsing in capability layer" guardrail note.

Exit criteria:
1. Future changes have clear contract docs and anti-regression guidance.

## 8. Acceptance Criteria (Product-Level)

All must pass:

1. User asks "Do I have any unread emails from today?" and gets a correct count without clarification.
2. Same for common natural-language date variants.
3. No fabricated certainty: if tool fails irrecoverably, assistant states limitation and next step.
4. Calendar date requests follow same temporal normalization behavior.
5. Tool routing remains stable under context hydration degradation.

## 9. Verification Commands for Implementing Agent

Run after each major workstream:

```bash
bun run lint
bun run test
bun run test:e2e
```

Run targeted suites during iteration:

```bash
bun run vitest tests/e2e/live-google-flow.test.ts
bun run vitest tests/e2e/critical-e2e-slack-google-tier1-basic.test.ts
bun run vitest tests/e2e/critical-e2e-slack-google-tier3-workflows.test.ts
```

## 10. Suggested Execution Order (Strict)

1. WS0 baseline tests.
2. WS1 temporal service.
3. WS2 capability migration.
4. WS3 routing hardening.
5. WS4 + WS5 unread tool/provider correctness.
6. WS6 clarification policy.
7. WS7 context degradation safety.
8. WS8 full tests.
9. WS9 docs cleanup.

## 11. Non-Goals (for this plan)

1. New observability platform work.
2. Broad product-scope expansion beyond inbox/calendar reliability.
3. Major model-provider migration.

## 12. Handoff Notes for Next Agent

Start here first:
1. Reproduce failure using WS0 tests.
2. Implement WS1/WS2 before touching planner behavior.
3. Keep changes schema-first and evidence-first; avoid adding more prompt heuristics.

Primary risk to avoid:
- Re-introducing lexical keyword shortcuts in new files. The fix must normalize language robustly via a canonical contract, not string-pattern branching.

## 13. Exhaustive Inbox/Calendar Reliability Audit Addendum (2026-02-24)

This addendum expands scope from temporal parsing to end-to-end inbox/calendar reliability, including all mutating actions, account selection, recurrence/exception handling, sync drift, and approval safety.

### 13.1 Audit Coverage

Audited code paths:
- Runtime routing/planning/tool admission: `src/server/features/ai/runtime/turn-contract.ts`, `src/server/features/ai/runtime/turn-planner.ts`, `src/server/features/ai/runtime/session.ts`, `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
- Runtime policy enforcement and approvals: `src/server/features/ai/runtime/mcp-tools.ts`, `src/server/features/ai/policy/enforcement.ts`, `src/server/features/policy-plane/pdp.ts`, `src/server/features/approvals/service.ts`, `src/server/features/approvals/execute.ts`, `src/server/features/approvals/rules.ts`
- Email capabilities/providers/integration: `src/server/features/ai/tools/runtime/capabilities/email.ts`, `src/server/features/ai/tools/providers/email.ts`, `src/server/features/email/providers/google.ts`, `src/server/features/email/process-history.ts`
- Calendar capabilities/providers/integration/sync: `src/server/features/ai/tools/runtime/capabilities/calendar.ts`, `src/server/features/ai/tools/providers/calendar.ts`, `src/server/integrations/google/calendar.ts`, `src/server/features/calendar/sync/google.ts`
- Surface/account routing: `src/server/features/channels/router.ts`, `src/server/lib/user-utils.ts`
- Existing tests: `src/server/features/calendar/sync/google.test.ts`, `src/server/features/email/process-history.test.ts`, `src/server/features/approvals/service.test.ts`, `src/server/features/ai/runtime/mcp-tools.test.ts`, `src/server/features/ai/tools/runtime/capabilities/*.test.ts`, `src/server/features/calendar/providers/google.test.ts`, `src/server/features/ai/tools/providers/email.search.test.ts`

Primary external references (official docs only):
- Gmail filtering/search (`q`, PST date literal caveat): https://developers.google.com/workspace/gmail/api/guides/filtering
- Gmail messages.list reference: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
- Gmail history.list reference: https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
- Gmail sync guide (404 invalid historyId => full sync): https://developers.google.com/workspace/gmail/api/guides/sync
- Calendar events.list (`syncToken` incompatibilities, 410 token invalidation): https://developers.google.com/workspace/calendar/api/v3/reference/events/list
- Calendar sync guide (full sync after token invalidation): https://developers.google.com/workspace/calendar/api/guides/sync
- Calendar recurring events guide (instances/exceptions/cancellations): https://developers.google.com/workspace/calendar/api/guides/recurringevents
- OpenAI function calling (strict schemas/tool reliability): https://platform.openai.com/docs/guides/function-calling
- Anthropic tool use (tool definitions + JSON schema discipline): https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
- Gemini function calling (clear descriptions, constrained enums): https://ai.google.dev/gemini-api/docs/function-calling

### 13.2 Full Write/Action Correctness Matrix

| Capability | Expected behavior | Actual implementation path | Failure modes found | Current test coverage | Missing tests | Severity |
| --- | --- | --- | --- | --- | --- | --- |
| Send (`sendNow`, `sendDraft`) | Exactly-once semantics under retries, explicit failure on partial/ambiguous provider state | `src/server/features/ai/tools/runtime/capabilities/email.ts:2128-2201` | No operation idempotency token for immediate send path; duplicate-send risk on retries/timeouts | Integration send approval path exists (`tests/integration/workflows/gmail-draft-approval-send.integration.test.ts`) | Retry/timeout duplicate-send, exactly-once assertions | P1 |
| Draft create/update/delete | Deterministic draft lifecycle and contract accuracy | `src/server/features/ai/tools/runtime/capabilities/email.ts:2000-2118`, registry schema `.../registry.ts:533-580` | `sendOnApproval` accepted by schema/executor but ignored in capability implementation | No direct runtime capability tests for `createDraft/updateDraft/deleteDraft` | Contract drift test for `sendOnApproval`; draft mutation behavior tests | P1 |
| Reply/Forward | Correct target message/thread and deduped send under retries | `src/server/features/ai/tools/runtime/capabilities/email.ts:2204-2432` | No explicit idempotency guard for send mode; timeout/retry can duplicate outbound mail | No dedicated reply/forward runtime mutation tests | Reply/forward duplicate-send and parent-resolution edge tests | P1 |
| Archive | Accurate success/failure accounting for bulk target set | `src/server/features/ai/tools/runtime/capabilities/email.ts:1443-1471`, provider modify `.../providers/email.ts:836-968` | Provider modify masks per-id failures and still returns `success: true` | No mutation behavior tests; only search-focused tests (`email.search.test.ts`) | Partial-failure surfacing + per-id result contract tests | P1 |
| Label apply/remove | Accurate per-item mutation reporting, idempotent retries | `src/server/features/ai/tools/runtime/capabilities/email.ts:1536-1599`, provider modify `.../providers/email.ts:836-968` | Same partial-failure masking as archive | No dedicated apply/remove labels tests | Partial failure + duplicate label op retries | P1 |
| Move thread | Deterministic provider support detection and truthful result | `src/server/features/ai/tools/runtime/capabilities/email.ts:1602-1627`, Gmail provider `src/server/features/email/providers/google.ts:1581-1590` | Gmail move is unsupported/no-op but capability returns success message | No tests for `email.moveThread` behavior | Unsupported-provider should return explicit error | P0 |
| Mark read/unread | Accurate mutation counts and failure surfaces | `src/server/features/ai/tools/runtime/capabilities/email.ts:1503-1534`, provider modify `.../providers/email.ts:836-968` | Partial failure masking causes over-reported success | No direct markReadUnread mutation tests | Partial-failure and retry consistency tests | P1 |
| Delete/trash | Approval-gated destructive behavior with truthful outcomes | `src/server/features/ai/tools/runtime/capabilities/email.ts:1473-1501`; registry metadata `.../registry.ts:303-313`; approval rules `src/server/features/approvals/rules.ts:174-183,191-197` | `batchTrash` mapped to `delete_email` operation; default approval only at >=25 items; destructive op can bypass always-approve intent | Approval engine tests exist but use abstract tool names (`approvals/rules.test.ts:85-104`) | Runtime `email.batchTrash` approval parity tests | P1 |
| Restore/untrash | Recovery action available for mistaken trash/delete | No runtime tool in registry/capabilities (`src/server/features/ai/tools/runtime/capabilities/registry.ts`, `.../email.ts`) | Missing capability class entirely; unsafe one-way mutability from agent UX | No tests | Add `email.restore`/`email.untrash` tool + policy + tests | P1 |
| Calendar create | Correct creation under retries; no duplicate events on ambiguous retries | `src/server/features/ai/tools/runtime/capabilities/calendar.ts:843-921`, provider retry `.../providers/calendar.ts:83-114,476-483` | Retries exist but no idempotency key on create; duplicate event risk on timeout-after-create | Basic provider wiring tests only (`calendar.providers/google.test.ts`) | Idempotent create semantics under retry/timeouts | P1 |
| Calendar update | Correct target event/instance selection (including recurrence exceptions) | `src/server/features/ai/tools/runtime/capabilities/calendar.ts:923-1024`, Google integration `src/server/integrations/google/calendar.ts:181-229` | `mode=single` updates first upcoming instance (`instances maxResults:1`) not deterministic intended instance | No recurrence exception tests | Moved/canceled exception targeting tests; DST boundary instance update tests | P0 |
| Calendar delete | Correct single vs series deletion with exception-safe targeting | `src/server/features/ai/tools/runtime/capabilities/calendar.ts:1026-1057`, Google integration `src/server/integrations/google/calendar.ts:327-352` | `mode=single` delete uses first upcoming instance heuristic; can delete wrong occurrence | Minimal mode plumbing test only (`calendar.providers/google.test.ts:320-342`) | Exception-specific delete tests (moved/canceled/past instances) | P0 |
| Calendar reschedule | Deterministic target selection, ambiguity-safe clarifications, recurrence correctness | `src/server/features/ai/tools/runtime/capabilities/calendar.ts:1161-1295` + update path above | Ultimately relies on same update heuristic for recurring single-instance changes | No dedicated reschedule mutation reliability tests | Recurrence + ambiguity + DST reschedule tests | P1 |

### 13.3 Multi-Account / Account Selection Audit

#### Finding MA-1 (P1): Implicit account selection is non-deterministic from user intent

Problem:
- Surface routing picks an email account without user/account disambiguation.

Why it matters:
- Wrong-account read/mutate actions are high-trust failures.

Evidence:
- `resolveEmailAccount` chooses most recently updated account when no explicit id: `src/server/lib/user-utils.ts:18-21`
- Channel router passes `null` preferred account: `src/server/features/channels/router.ts:365-367`

Solution:
1. Require explicit account binding when user has >1 connected email account and request is inbox/calendar scoped.
2. Add deterministic disambiguation order: explicit mention -> active thread account -> configured primary -> single clarifying question.
3. Persist explicit account decision in conversation state to avoid repeated prompts.

Acceptance criteria:
- No inbox/calendar action executes with >1 account unless account is explicitly bound or deterministic rule is satisfied.
- Wrong-account reproduction tests fail before fix and pass after fix.

Required tests:
- Multi-account read turn with no account reference asks one clarification.
- Multi-account mutate turn hard-blocks until account resolved.
- Conversation follow-up reuses previously bound account deterministically.

### 13.4 Recurrence / Exception / Timezone Edge Cases

#### Finding RC-1 (P0): Single-instance recurring update/delete uses “first upcoming instance” heuristic

Problem:
- Single-instance operations patch/delete `instances[0]` using `timeMin`, not the intended instance identity.

Why it matters:
- Can modify/delete wrong meeting occurrence, especially with exceptions/cancellations.

Evidence:
- Update path: `src/server/integrations/google/calendar.ts:181-193`
- Delete path: `src/server/integrations/google/calendar.ts:327-339`
- Calendar recurrence semantics and exception handling require instance-specific identity handling: https://developers.google.com/workspace/calendar/api/guides/recurringevents

Solution:
1. Require instance identity (`eventId` of occurrence or `originalStartTime`) for `mode=single` recurring edits.
2. If only series id provided, resolve candidate set and ask explicit disambiguation.
3. Persist selected occurrence identifier through execution and approval payload.

Acceptance criteria:
- Single-instance edits/deletes never target by “first upcoming” heuristic.
- Exception/moved/canceled instances are correctly handled and auditable.

Required tests:
- Update/delete moved instance.
- Update/delete canceled instance behavior.
- DST boundary occurrence update (spring/fall transitions).

### 13.5 Sync Drift / Token Invalidation / Replay Safety

#### Finding SYNC-1 (P0): Calendar 410 recovery skips canonical-state reconciliation

Problem:
- On 410 token invalidation, code resets token and returns events but does not replay canonical upsert/delete reconciliation.

Why it matters:
- Canonical shadow can drift from provider truth after invalidation recovery.

Evidence:
- Normal canonical reconciliation: `src/server/features/calendar/sync/google.ts:264-334`
- 410 branch returns canonical processed/deleted/remapped all zero: `src/server/features/calendar/sync/google.ts:363-387`
- Calendar API guidance requires full sync after invalidation: https://developers.google.com/workspace/calendar/api/guides/sync and `events.list` docs on invalid sync token/410: https://developers.google.com/workspace/calendar/api/v3/reference/events/list

Solution:
1. Extract canonical reconciliation into shared routine and execute it in both normal and 410 recovery paths.
2. Mark recovery runs with source metadata (`sync_reset_replay`) for audit.
3. Add replay-safe idempotent upsert/delete semantics for recovered pages.

Acceptance criteria:
- 410 recovery updates canonical shadow exactly as standard incremental path.
- No drift between provider event state and canonical shadow after forced token reset test.

Required tests:
- 410 branch with mix of active + canceled events updates canonical counters and snapshots.
- Replayed recovery pages are idempotent.

#### Finding SYNC-2 (P1): Gmail expired history path resets pointer without backfill

Problem:
- On invalid/expired historyId, implementation advances pointer to webhook history id and returns success without full backfill.

Why it matters:
- Silent data loss/drift for events between last valid sync point and new pointer.

Evidence:
- Expired handling returns `{ status: "expired" }`: `src/server/features/email/process-history.ts:397-406`
- Caller advances stored pointer and exits: `src/server/features/email/process-history.ts:107-113`
- Gmail sync guidance states invalid/old historyId requires full sync: https://developers.google.com/workspace/gmail/api/guides/sync

Solution:
1. Replace “advance pointer only” with full backfill job enqueue on expired history id.
2. Gate pointer advance until backfill completes successfully.
3. Emit explicit drift-recovery marker for observability/audit log.

Acceptance criteria:
- Expired historyId does not skip backfill.
- Backfill completion sets pointer deterministically once.

Required tests:
- Expired historyId triggers backfill workflow.
- Pointer is not advanced before backfill success.

#### Finding SYNC-3 (P1): Calendar sync token update is race-prone under concurrent syncs

Problem:
- Sync token is updated by plain write with no conditional guard/lock.

Why it matters:
- Concurrent workers can overwrite token with stale value.

Evidence:
- Unconditional token updates: `src/server/features/calendar/sync/google.ts:337-342,369-372`
- Contrast with Gmail monotonic pointer protection via conditional update: `src/server/features/email/process-history.ts:249-275`

Solution:
1. Add optimistic concurrency guard (token compare-and-set) or row-level serialization per calendar.
2. Reject/ignore stale token writes when run context no longer current.

Acceptance criteria:
- Concurrent sync runs cannot regress stored sync token.

Required tests:
- Simulated concurrent sync writes keep latest valid token.

### 13.6 Permission / Approval Gating Reliability

#### Finding AP-1 (P1): Destructive trash operation can bypass always-approval intent

Problem:
- `email.batchTrash` is mapped as delete operation with conditional bulk threshold, not always-approval trash semantics.

Why it matters:
- High-risk destructive action can run without explicit approval for small batches.

Evidence:
- Registry maps `email.batchTrash` to `approvalOperation: "delete_email"`: `src/server/features/ai/tools/runtime/capabilities/registry.ts:303-310`
- Default delete policy only requires approval for `minItemCount: 25`: `src/server/features/approvals/rules.ts:174-183`
- Separate always-approval `trash_email` rule lives in modify policy: `src/server/features/approvals/rules.ts:191-197`

Solution:
1. Align `email.batchTrash` operation mapping to `trash_email` (or explicit canonical destructive op) and enforce always approval.
2. Add parity assertion test between registry approvalOperation and rules expectation.

Acceptance criteria:
- Any `email.batchTrash` invocation requires approval regardless item count.

Required tests:
- Runtime tool execution path asserts `require_approval` for single-id `email.batchTrash`.

#### Finding AP-2 (P1): Expired approval requests are still honored

Problem:
- Approval decision path logs expiry but still transitions request to APPROVED/DENIED.

Why it matters:
- Stale approvals can authorize actions outside intended validity window.

Evidence:
- Expiry warning without enforcement: `src/server/features/approvals/service.ts:105-113`
- Status is still updated after warning: `src/server/features/approvals/service.ts:116-120`
- Test explicitly validates this behavior: `src/server/features/approvals/service.test.ts:117-147`

Solution:
1. Enforce hard expiry rejection (`EXPIRED`) before decision write.
2. Require re-approval issuance for expired requests.

Acceptance criteria:
- Expired approval cannot execute mutation.

Required tests:
- Decision on expired request returns explicit error/status and does not write approval decision.

#### Finding AP-3 (P2): Approval execution contract drift around `sendOnApproval`

Problem:
- Tool schema/executor accepts `sendOnApproval`, but runtime draft capability does not implement send-on-approval behavior.

Why it matters:
- Users/models can believe send-on-approval is active when it is ignored.

Evidence:
- Schema includes `sendOnApproval`: `src/server/features/ai/tools/runtime/capabilities/registry.ts:533-544`
- Executor forwards field: `src/server/features/ai/tools/runtime/capabilities/executors/email.ts:109-117`
- Capability createDraft ignores field: `src/server/features/ai/tools/runtime/capabilities/email.ts:2000-2045`

Solution:
1. Either implement send-on-approval end-to-end or remove field from contract.
2. Add schema-contract test ensuring all accepted fields affect behavior.

Acceptance criteria:
- No accepted input field is semantically ignored.

Required tests:
- `sendOnApproval=true` creates approval + deferred send path (or validation error if removed).

### 13.7 Tool-Calling Reliability / Deterministic Failure Handling

#### Finding TC-1 (P1): Email mutation provider masks partial failures as full success

Problem:
- Mutation loop logs per-item failures but returns `{ success: true, count }` regardless.

Why it matters:
- Violates evidence-truthfulness and prevents safe retries/remediation.

Evidence:
- Catch-and-log per item: `src/server/features/ai/tools/providers/email.ts:962-964`
- Always returns success true: `src/server/features/ai/tools/providers/email.ts:967`
- Provider best-practice guidance emphasizes reliable structured outputs and schema-faithful tool results:
  - OpenAI: https://platform.openai.com/docs/guides/function-calling
  - Anthropic: https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use
  - Gemini: https://ai.google.dev/gemini-api/docs/function-calling

Solution:
1. Return structured per-item results: succeeded ids, failed ids, retriable flag.
2. Set top-level `success=false` on any failed item (or `partial` outcome with explicit semantics).
3. Propagate deterministic retry instructions to runtime.

Acceptance criteria:
- Mutation result cannot report full success when any item failed.

Required tests:
- Mixed success/failure bulk mutation returns partial/failure payload with failed item list.

#### Finding TC-2 (P0): Unsupported Gmail move operation reports successful completion

Problem:
- Gmail adapter warns move unsupported/no-op, but capability reports success and moved count.

Why it matters:
- Direct false-positive on mutating action.

Evidence:
- Capability success response after provider call: `src/server/features/ai/tools/runtime/capabilities/email.ts:1619-1627`
- Gmail move implementation is no-op warning: `src/server/features/email/providers/google.ts:1581-1590`

Solution:
1. Advertise provider support in capability layer and hard-fail unsupported operations.
2. Include provider capability matrix in tool metadata for routing-time pruning.

Acceptance criteria:
- `email.moveThread` on Gmail returns explicit unsupported error, never success.

Required tests:
- Gmail `moveThread` returns deterministic unsupported result.

#### Finding TC-3 (P2): Semantic family mapping can over-prune inbox/calendar tools

Problem:
- `general + read` maps semantic families to `web_read` only.

Why it matters:
- Planner misclassification can drop relevant internal tools.

Evidence:
- `general` read mapping: `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts:96-99`

Solution:
1. Add fallback admission guard for inbox/calendar entities when planner domain is uncertain.
2. Keep hybrid families for ambiguous read turns (`web_read` + internal read families).

Acceptance criteria:
- Inbox/calendar factual queries retain inbox/calendar candidate tools even with uncertain domain classification.

Required tests:
- Misclassified `general` read query containing inbox/calendar entities still includes internal tools.

### 13.8 Scheduling Queue Safety

#### Finding SQ-1 (P1): `scheduleSend` can leave orphaned pending state on publish failure

Problem:
- DB row is created as `PENDING` before queue publish; publish failure path does not set deterministic failure status.

Why it matters:
- Orphaned pending jobs and ambiguous execution truth.

Evidence:
- Row create first: `src/server/features/ai/tools/runtime/capabilities/email.ts:2489-2502`
- Publish second: `src/server/features/ai/tools/runtime/capabilities/email.ts:2519-2533`
- Catch returns generic failure without status compensation: `src/server/features/ai/tools/runtime/capabilities/email.ts:2559-2568`

Solution:
1. Wrap create+publish in compensating transaction pattern.
2. On publish failure, update row status to `FAILED_TO_SCHEDULE` with error payload.
3. Add retriable reconciliation worker for orphaned pending rows.

Acceptance criteria:
- Failed publish never leaves ambiguous `PENDING` schedule rows.

Required tests:
- Simulated QStash publish failure marks schedule row failed and reports deterministic error.

### 13.9 Query/Temporal Correctness Notes

#### No material issue found: provider-level date-range semantics for inbox read are aligned with Gmail guidance

Why:
- Email capability routes date-windowed search through provider with explicit `before/after` Date objects (`src/server/features/ai/tools/runtime/capabilities/email.timezone.test.ts:106-137`), and Gmail query construction uses date-aware filtering path. This aligns with Gmail guidance to avoid naive date-literal assumptions across time zones.

References:
- Gmail filtering guide PST caveat: https://developers.google.com/workspace/gmail/api/guides/filtering

#### No material issue found: runtime enforces policy before tool arg parse/execute

Why:
- Policy enforcement is always executed before schema parse and tool execution in runtime path (`src/server/features/ai/runtime/mcp-tools.ts:126-177`).

### 13.10 Additional Architecture/Test Gaps

#### Finding TG-1 (P1): Mutation reliability test coverage is materially incomplete

Problem:
- Existing tests focus heavily on search/timezone/policy filtering; direct mutation correctness is under-tested.

Evidence:
- Search-centric provider tests: `src/server/features/ai/tools/providers/email.search.test.ts:9-210`
- No tests for `moveThread`, `scheduleSend`, `sendOnApproval`, `updateRecurringMode`, `rescheduleEvent` by name across runtime/integration suites (`rg` audit result on 2026-02-24).
- Calendar provider delete test only verifies mode passthrough: `src/server/features/calendar/providers/google.test.ts:320-342`

Solution:
1. Add mutation reliability suites with deterministic failure injection.
2. Require per-capability tests for all mutating inbox/calendar tools.
3. Add concurrency/replay tests for sync and scheduling operations.

Acceptance criteria:
- Every mutating capability has success + partial failure + retry idempotency tests.

Required tests:
- New suites under `src/server/features/ai/tools/runtime/capabilities/*.mutation.test.ts`
- Sync concurrency tests under `src/server/features/calendar/sync/google.test.ts`

## 14. Updated Implementation Workstreams (Superseding WS0-WS9)

1. `R0` Test baseline expansion for all mutating inbox/calendar capabilities.
2. `R1` Fix P0 action correctness defects (`moveThread` truthfulness; recurring single-instance targeting; calendar 410 canonical replay).
3. `R2` Sync/backfill hardening (Gmail expired history full backfill; calendar sync token race guard).
4. `R3` Approval consistency hardening (trash op mapping parity; hard expiry enforcement).
5. `R4` Idempotency and retry safety for send/create/update/delete paths.
6. `R5` Multi-account deterministic selection and explicit clarification policy.
7. `R6` Contract cleanup (`sendOnApproval` implement-or-remove, provider capability flags).
8. `R7` Regression suite and reliability acceptance validation.

## 15. Revised Product-Level Acceptance Criteria

All criteria below must pass to consider inbox/calendar reliability acceptable:

1. All mutating inbox actions (send, draft lifecycle, reply/forward, archive, label, move, read/unread, trash/delete, restore) are truthful and deterministic under retries and partial failures.
2. Calendar create/update/delete/reschedule behavior is correct for recurrence exceptions, moved/canceled instances, timezone shifts, and DST boundaries.
3. Multi-account users never execute inbox/calendar actions on an implicitly wrong account.
4. Sync token/history invalidation paths recover with replay-safe backfill and no silent drift.
5. All mutating operations obey consistent approval gating; expired approvals are never executable.
6. Every claim in user-facing responses is backed by successful tool evidence or explicit uncertainty.
