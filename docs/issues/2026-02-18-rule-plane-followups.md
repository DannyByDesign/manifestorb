# Rule Plane Followups (Unified Policy Plane)

Context: The unified rule plane is implemented as canonical rules (`CanonicalRule`) powering guardrails, automations, and preferences.

## Followups

- Unify condition language and evaluation between:
  - Tool-time PDP evaluation (`src/server/features/policy-plane/pdp.ts`)
  - Event-time email automation evaluation (`src/server/features/policy-plane/automation-executor.ts`)
  Goal: the compiler should emit one stable field namespace, and both PDP + automation executor should share the same matcher.

- Improve `policy.dryRunRule` semantics:
  - Current behavior uses unified search with `sourceNl`/name/description as a query.
  - Desired: for email automations, fetch candidate emails and evaluate actual `match.conditions` against message context; for guardrails, provide a “simulate tool invocation” mode with sample args.

- Add first-class enable/disable UX:
  - API supports `PATCH /api/rule-plane/:id` with `disabled=true|false`; UI currently only supports delete.
  - Add UI affordances: disable until, re-enable, and show disabled-until timestamp.

- Define precedence rules explicitly:
  - Account-scoped vs global rules at equal priority should be deterministic and documented.
  - Consider exposing “scope” and “applies to account/global” in UI and rule listings.

- Audit/extend automation triggers:
  - Canonical schema supports `schedule` and `manual`, executor currently only supports `event=email.received`.
  - Decide which trigger kinds are in-scope for v1 and implement the missing ones (or validate + reject on create).

