# 2026-02-15 Fast Path Coverage Source of Truth

## Objective
Replace the current narrow fast-path coverage with a high-leverage, high-frequency coverage model that is:
1. Correct-first (never knowingly returns partial/incorrect facts as complete).
2. Ultra-fast (p95 latency target <= 3s for true fast-path turns).
3. Cheap (single deterministic tool call where possible, minimal model token usage).
4. Embedding-native (semantic stage is first-class, not regex-only routing).

This plan supersedes ad-hoc fast-path scope currently encoded in:
- `src/server/features/ai/runtime/fast-path.ts:383`
- `src/server/features/ai/runtime/fast-path.ts:399`
- `src/server/features/ai/runtime/fast-path.ts:459`
- `src/server/features/ai/runtime/fast-path.ts:471`
- `src/server/features/ai/runtime/fast-path.ts:519`

## Hard Product Constraints
- Users will not know rule IDs.
- Any fast-path rule operation that requires exact ID matching must either:
  1. Resolve target from plain English reliably, or
  2. Not be in fast path.

Decision for this plan:
- Keep in fast path now: rule list + rule create.
- Remove from fast path now: rule disable/delete by explicit ID pattern.
- Route rule disable/delete through planner until deterministic plain-English rule resolution is implemented safely.

## Current Pipeline (Relevant)
- Semantic contract (embedding-first, lexical fallback):
  - `src/server/features/ai/runtime/semantic-contract.ts:375`
- Tool narrowing and deterministic policy filtering:
  - `src/server/features/ai/runtime/session.ts:163`
- Routing lane and strict fast-path check:
  - `src/server/features/ai/runtime/router.ts:136`
  - `src/server/features/ai/runtime/router.ts:142`
- Fast-path matcher and coverage rules:
  - `src/server/features/ai/runtime/fast-path.ts:375`
- Fast-path execution and completeness guard fallback:
  - `src/server/features/ai/runtime/attempt-loop.ts:244`
  - `src/server/features/ai/runtime/attempt-loop.ts:278`

## New Fast-Path Admission Model
Fast path becomes semantic-first + deterministic-slot-gated:

1. Semantic candidate stage (embedding):
- Use semantic contract intent/domain/operation/confidence as primary admission signal.
- Require minimum confidence and margin over next best candidate (new).

2. Deterministic slot validation stage:
- Validate required arguments for each operation (date window, sender, thread anchor, etc.).
- If required slots missing/ambiguous, do not fast-path.

3. Tool availability + policy gate stage:
- Verify selected operation’s tool exists in filtered runtime registry.
- If unavailable, do not fast-path.

4. Completeness/accuracy stage:
- For count operations, require complete result or provider-estimated total with explicit certainty rule.
- If incomplete, auto-fallback to planner.

## Replacement Coverage Matrix (High-Frequency + High-Leverage)

### A. Meta (always fast-path)
1. Greeting
- Examples: "hello", "hey"
- Response: direct short assistant response
- No tools

2. Capability question
- Examples: "what can you do", "how can you help"
- Response: direct capability summary
- No tools

### B. Inbox Read (fast-path)
3. Latest/first inbox item
- Examples: "first email in my inbox", "latest email"
- Tool: `email.searchInbox` (`limit=1`, `fetchAll=false`)
- Completeness rule: exact by construction

4. Inbox count in explicit time window
- Examples: "how many emails today", "how many unread emails today"
- Tool: `email.searchInbox` with explicit `dateRange`
- Completeness rule: `requireCompleteResult=true`

5. Unread count (no date or explicit date)
- Examples: "how many unread emails", "unread emails today"
- Tool: `email.searchInbox` with `query=is:unread`
- Completeness rule: `requireCompleteResult=true`

6. List unread in explicit date window
- Examples: "show unread emails today"
- Tool: `email.searchInbox` with `query=is:unread` + `dateRange`
- Completeness rule: truncated allowed only when response says partial and planner fallback is optional by policy

7. Sender-scoped list in explicit window
- Examples: "emails from alex today"
- Tool: `email.searchInbox` with `from`/query + `dateRange`
- Completeness rule: same as #6

8. Subject/text-scoped list in explicit window
- Examples: "emails about invoice this week"
- Tool: `email.searchInbox` with `subjectContains/text` + `dateRange`
- Completeness rule: same as #6

### C. Calendar Read (fast-path)
9. Meetings/events for today/tomorrow/day-name/this week/next week
- Examples: "what meetings do I have today", "meetings next week"
- Tool: `calendar.listEvents` with deterministic date window
- Completeness rule: explicit window must be resolved in user timezone

10. Next meeting
- Examples: "what’s my next meeting"
- Tool: `calendar.listEvents` with `after=now` short horizon
- Completeness rule: if no future events in horizon, return none

11. Event count in explicit window
- Examples: "how many meetings today"
- Tool: `calendar.listEvents` with explicit `dateRange`
- Completeness rule: deterministic count from returned set

12. Current/ongoing meeting check
- Examples: "am I in a meeting right now"
- Tool: `calendar.listEvents` for today + local-time overlap check
- Completeness rule: local timezone required

### D. Rule Management (fast-path, safe subset)
13. List rules
- Examples: "show my rules", "list my automations"
- Tool: `policy.listRules`

14. Create rule from natural language
- Examples: "create a rule to archive newsletters"
- Tool: `policy.createRule` with raw user input

### E. Explicitly Not Fast-Path (planner required)
15. "What emails need attention / need response"
- Reason: requires judgment/triage, not deterministic count/list

16. Multi-step or conditional tasks
- Examples: "if X then Y", "check inbox then reschedule"

17. Rule disable/delete/update by plain English description (for now)
- Reason: current fast path requires explicit ID (`fast-path.ts:434`)
- Must go planner until deterministic resolver is implemented

## Implementation Plan (Line-Level)

### Phase 1: Semantic-First Fast-Path Candidateing
1. Extend semantic output for fast-path candidate quality
- File: `src/server/features/ai/runtime/semantic-contract.ts`
- Add top-2 candidate score + margin output in contract metadata.
- Touch points:
  - intent scoring loop: `semantic-contract.ts:356`
  - return contract path: `semantic-contract.ts:367`
  - fallback path: `semantic-contract.ts:410`

2. Introduce minimum confidence + margin constants for fast-path admission
- File: `src/server/features/ai/runtime/semantic-contract.ts`
- Near existing threshold:
  - `MIN_SEMANTIC_SCORE` at `semantic-contract.ts:45`

### Phase 2: Replace Regex-Primary Matcher with Operation Catalog
1. Add operation catalog + slot validators
- File: `src/server/features/ai/runtime/fast-path.ts`
- Refactor from current inline condition chain:
  - starts: `fast-path.ts:383`
  - ends: `fast-path.ts:542`
- Create deterministic operation definitions:
  - operation id
  - semantic intent allowlist
  - lexical guard
  - required slots
  - tool mapping
  - completeness requirement

2. Remove rule-ID-only disable/delete fast path
- File: `src/server/features/ai/runtime/fast-path.ts`
- Remove/disable block:
  - `fast-path.ts:434` through `fast-path.ts:457`
- Route these to planner by returning `null` in strict mode.

3. Keep safe rule coverage
- File: `src/server/features/ai/runtime/fast-path.ts`
- Keep/upgrade:
  - list rules block: `fast-path.ts:399`
  - create rule block: `fast-path.ts:418`

### Phase 3: Accuracy Guarantees for Count/List
1. Make count paths completeness-safe across providers
- File: `src/server/features/ai/tools/runtime/capabilities/email.ts`
- Update search limiting policy to be operation-aware instead of generic caps:
  - `computeEmailSearchLimit` at `email.ts:173`
  - limit normalization at `email.ts:352`
- Add explicit mode for count-grade queries to avoid undercount.

2. Enforce fast-path fallback on incomplete count
- File: `src/server/features/ai/runtime/attempt-loop.ts`
- Keep and extend existing guard:
  - `attempt-loop.ts:278`
- Add reason telemetry for fallback cause.

3. Improve date window parsing correctness in timezone
- File: `src/server/features/ai/runtime/fast-path.ts`
- Reuse current timezone-aware date logic:
  - `inferCalendarDateRange` at `fast-path.ts:173`
  - `inferExplicitDateRange` at `fast-path.ts:228`
- Add regression tests for local-day boundary edge cases.

### Phase 4: Router + Budget Alignment
1. Add explicit fast-path SLA budget and timeout
- File: `src/server/features/ai/runtime/router.ts`
- Add fast-path budget constants near route presets:
  - `router.ts:35`
- Ensure fast-path execution budget <= 3s target where feasible.

2. Keep planner fallback immediate when fast path not admissible
- File: `src/server/features/ai/runtime/router.ts`
- Existing strict check entry:
  - `router.ts:142`

### Phase 5: Tests (Coverage as Contract)
1. Replace current narrow tests with matrix-backed tests
- File: `src/server/features/ai/runtime/fast-path.test.ts`
- Expand from current limited set:
  - `fast-path.test.ts:129`
- Add cases for all operations in this matrix.

2. Add semantic candidate confidence/margin tests
- New file: `src/server/features/ai/runtime/semantic-contract.test.ts`
- Validate embedding + fallback behavior and admission thresholds.

3. Add provider parity tests for count correctness
- Files:
  - `src/server/features/ai/tools/runtime/capabilities/email.timezone.test.ts`
  - add provider-behavior fixtures for Gmail and Microsoft count semantics.

### Phase 6: Observability + Safety
1. Emit fast-path decision telemetry
- File: `src/server/features/ai/runtime/attempt-loop.ts`
- Include:
  - selected operation id
  - semantic confidence/margin
  - slot validation failures
  - completeness fallback reason

2. Add unsupported-fast-path intent telemetry
- Reuse unsupported intent telemetry module:
  - `src/server/features/ai/runtime/telemetry/unsupported-intents.ts:21`

## Migration Order
1. Phase 2 (remove ID-dependent rule mutation fast path).
2. Phase 1 (semantic confidence/margin metadata).
3. Phase 3 (count correctness + completeness).
4. Phase 5 (full test matrix).
5. Phase 4 + 6 (SLA tuning + telemetry hardening).

## Acceptance Criteria
1. Correctness
- No fast-path response returns count claims when result is incomplete.
- Date-window requests are interpreted in user timezone for email/calendar.
- Rule disable/delete never asks for raw ID in fast path because those operations are not fast-pathed.

2. Latency
- p95 <= 3s for covered fast-path operations in healthy provider conditions.

3. Cost
- Covered operations execute with one deterministic tool call and no planner loop.

4. UX
- Responses stay conversational assistant style (not robotic templates).
- When request is out-of-scope for fast path, planner fallback is automatic and silent.

## Out of Scope (for this cut)
- Fast-path semantic triage for "needs response"/priority inference.
- Fast-path multi-step workflows.
- Fast-path plain-English rule disable/delete resolution.

## Follow-Up (Optional, Next Cut)
Implement deterministic plain-English rule target resolver:
1. `policy.listRules` fetch.
2. Embed user description + rule descriptors.
3. Select top match only if confidence + margin threshold passes.
4. Else planner clarification.

This allows safe re-introduction of rule disable/delete in fast path without requiring user IDs.
