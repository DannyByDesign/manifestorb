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
