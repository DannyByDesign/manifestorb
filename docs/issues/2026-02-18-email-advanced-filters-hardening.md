# Email Advanced Filters Hardening (Gmail)

## Context
Question bank includes filters that are currently implemented as heuristics or partially enforced:

- "recruiters only"
- "sent but didn't get a reply" (thread scanning)
- attachment type/filename filtering
- Gmail categories (promotions, etc)

## Problem
Some filters are enforced via local filtering/heuristics which can be brittle and may not hit 100% reliability.

## Acceptance Criteria
- Make recruiter-only filtering deterministic and explainable.
  - Either via user-configured recruiter domains/allowlist, or structured sender category.
- Add eval-style tests that assert these filters behave correctly given representative fixtures.
- Ensure unified search and provider fallback apply the same hard constraints.
