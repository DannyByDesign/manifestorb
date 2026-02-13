# Unified Rule Plane Implementation Tracker

## Source of Truth Docs

- Architecture: `docs/plans/UNIFIED_RULE_PLANE_ARCHITECTURE.md`
- Schema spec: `docs/plans/UNIFIED_RULE_SCHEMA_SPEC.md`
- Migration plan: `docs/plans/UNIFIED_RULE_PLANE_MIGRATION_PLAN.md`

## Phase Status

- [x] Phase 1: canonical schema + migration adapters planning docs
- [x] Phase 2: PDP integration into skills execution
- [ ] Phase 3: automation engine integration
- [ ] Phase 4: preference-rule planner constraints
- [ ] Phase 5: NL compiler + explanation loop
- [ ] Phase 6: unified UI + AI rule-management skills
- [ ] Phase 7: eval gates + telemetry dashboards

## Acceptance Criteria Status

- [ ] No policy bypass for mutating actions.
- [ ] No unsupported action reported as success.
- [ ] Approval-required actions always produce actionable approval objects.
- [ ] Multi-turn approval and clarification resumes correctly.

## Runtime Integration PR Checklist by Phase

## Phase 2 PRs

- [x] PR2.1: Introduce PDP entrypoint module and intent/decision contracts.
- [x] PR2.2: Route skill mutation policy checks through PDP.
- [x] PR2.3: Route planner mutation policy checks through PDP.

## Phase 3 PRs

- [x] PR3.1: Route rule automation action dispatch through PDP.
- [x] PR3.2: Route scheduled action execution through PDP.
- [ ] PR3.3: Remove direct mutation paths that bypass PDP.

## Phase 4 PRs

- [ ] PR4.1: Convert preference constraints into canonical preference rules.
- [ ] PR4.2: Apply preference constraints in planner/skill parameterization.

## Phase 5 PRs

- [ ] PR5.1: NL-to-rule compiler (parse -> normalize -> validate -> lint).
- [ ] PR5.2: Explanation loop + correction preview before activation.
- [ ] PR5.3: Persist source NL + compiler diagnostics.

## Phase 6 PRs

- [ ] PR6.1: Unified rule plane API endpoints (list/create/update/disable/explain).
- [ ] PR6.2: Web UI unification for guardrails/automations/preferences.
- [ ] PR6.3: AI chat skills for rule management.

## Phase 7 PRs

- [ ] PR7.1: Decision/execution telemetry pipelines.
- [ ] PR7.2: Policy bypass and approval dead-end dashboards.
- [ ] PR7.3: Gate checks and rollout criteria automation.
