# Skills Failure Taxonomy Review

Last updated: 2026-02-13

## Failure Categories

The runtime maps failures into deterministic classes:

- `missing_context`
  - missing required slots
  - ambiguous references (`that thread`, `that event`)
- `policy`
  - approval required
  - conflict with working-hours policy
- `transient`
  - rate limit
  - timeout
  - temporary provider errors
- `provider`
  - not found
  - invalid input from user/provider mismatch
  - downstream execution failures
- `unsupported`
  - capability exists but environment/provider cannot support it
- `unknown`
  - uncategorized failures (should trend to zero)

## Mapping Rules

1. Never return generic "unexpected error" for actionable user flows.
2. Prefer `blocked` status when user action can resolve the issue.
3. Prefer `failed` status when external transient/provider issue is root cause.
4. Include deterministic reason code in execution telemetry.

## Review Procedure

- Sample at least 50 failed/blocked turns.
- Verify each has:
  - non-empty reason code
  - valid category
  - user-facing message with next action
- Record top 5 recurring reason codes and remediation owner.

## Current Expected Top Codes

- `missing_required_slots`
- `approval_required`
- `working_hours_conflict`
- `invalid_input:*`
- `rate_limit:*`
- `unsupported:*`

