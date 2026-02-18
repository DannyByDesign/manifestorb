# IR-018 "Sent But No Reply" - Performance and Coverage

## Context
`IR-018` ("Find emails I sent but didn't get a reply to") is now implemented deterministically via a DB-first query over `EmailMessage` with a provider-scanning fallback.

The DB query relies on `DISTINCT ON (threadId)` and an anti-join against inbound messages after the last sent message in-range.

## Status
- 2026-02-18: Implemented composite DB index + added regression tests covering unreplied semantics and missing date range clarification.

## Why This Issue Exists
The logic is correct, but at large scale (high message volume per account) we should harden:
- Query performance (indexing/plan stability).
- Regression coverage (fixtures + targeted test cases for subtle thread timelines).

## Acceptance Criteria
- Add a targeted composite index to support the DB query shape efficiently:
  - Candidate: `("emailAccountId", "threadId", "sent", "date")` (or a better shape proven by `EXPLAIN (ANALYZE, BUFFERS)` in prod-like data).
- Add test coverage that asserts the unreplied semantics deterministically:
  - Last sent in range, inbound after last sent -> excluded.
  - Multiple sent messages in range, inbound reply only to earlier sent -> still excluded if reply after latest sent.
  - Inbound message before the last sent -> does not count as reply.
  - Thread with only sent messages -> included.
- Keep user-visible follow-up text out of tool layer:
  - Clarification should remain `clarification.prompt` keys only.
