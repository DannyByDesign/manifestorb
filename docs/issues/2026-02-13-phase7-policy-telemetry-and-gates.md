# Issue: Phase 7 Policy Telemetry + Gate Automation

## Context

Unified Rule Plane phases 1-6 are complete. Phase 7 is intentionally out of scope for this delivery and remains open.

## Scope

Implement the remaining Phase 7 items from `docs/plans/UNIFIED_RULE_PLANE_IMPLEMENTATION_TRACKER.md`:

1. Decision/execution telemetry pipelines.
2. Policy bypass and approval dead-end dashboards.
3. Gate checks and rollout criteria automation.

## Required Outcomes

- Runtime dashboards expose policy decision outcomes and execution outcomes by source (`skills`, `planner`, `automation`, `scheduled`).
- Approval dead-end monitoring is actionable (alerts for `require_approval` without follow-up decisions).
- Rollout gate checks can fail builds/deploy promotion when thresholds are not met.

## Notes

- Keep policy plane enforcement behavior unchanged.
- Add observability and gates only; do not weaken existing policy boundaries.
