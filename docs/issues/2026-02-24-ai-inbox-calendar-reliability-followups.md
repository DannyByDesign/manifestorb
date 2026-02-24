# 2026-02-24 AI Inbox/Calendar Reliability Follow-ups

## Context

Tracking issue for follow-up implementation work captured in:
- `docs/plans/2026-02-24-ai-inbox-calendar-agent-reliability-implementation-plan.md`

## Open Items

1. Implement canonical temporal normalization service and migrate all inbox/calendar tools to it.
2. Remove keyword-coupled date extraction paths from capability layer.
3. Harden routing/tool admission so inbox/calendar reads never fall into tool-less conversation lane.
4. Make `email.countUnread` schema-first and deterministic under transient failure.
5. Fix Gmail query construction for timezone-correct "today" semantics via epoch boundaries.
6. Rewrite clarification policy to be ambiguity-only and evidence-first.
7. Add regression tests for natural-language time phrasing and timezone boundaries.

## Exit Condition

Close this issue when all WS0-WS9 acceptance criteria in the linked plan are complete and passing.
