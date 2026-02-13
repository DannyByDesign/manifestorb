# Unified Rule Plane Implementation Tracker

## Source of Truth Docs

- Architecture: `docs/plans/UNIFIED_RULE_PLANE_ARCHITECTURE.md`
- Schema spec: `docs/plans/UNIFIED_RULE_SCHEMA_SPEC.md`
- Migration plan: `docs/plans/UNIFIED_RULE_PLANE_MIGRATION_PLAN.md`

## Phase Status

- [x] Phase 1: canonical schema + migration adapters planning docs
- [x] Phase 2: PDP integration into skills execution
- [x] Phase 3: automation engine integration
- [x] Phase 4: preference-rule planner constraints
- [x] Phase 5: NL compiler + explanation loop
- [x] Phase 6: unified UI + AI rule-management skills
- [ ] Phase 7: eval gates + telemetry dashboards

## Acceptance Criteria Status

- [x] No policy bypass for mutating actions.
- [x] No unsupported action reported as success.
- [x] Approval-required actions always produce actionable approval objects.
- [x] Multi-turn approval and clarification resumes correctly.

## Runtime Integration PR Checklist by Phase

## Phase 2 PRs

- [x] PR2.1: Introduce PDP entrypoint module and intent/decision contracts.
- [x] PR2.2: Route skill mutation policy checks through PDP.
- [x] PR2.3: Route planner mutation policy checks through PDP.

## Phase 3 PRs

- [x] PR3.1: Route rule automation action dispatch through PDP.
- [x] PR3.2: Route scheduled action execution through PDP.
- [x] PR3.3: Remove direct mutation paths that bypass PDP.

## Phase 4 PRs

- [x] PR4.1: Convert preference constraints into canonical preference rules.
- [x] PR4.2: Apply preference constraints in planner/skill parameterization.

## Phase 5 PRs

- [x] PR5.1: NL-to-rule compiler (parse -> normalize -> validate -> lint).
- [x] PR5.2: Explanation loop + correction preview before activation.
- [x] PR5.3: Persist source NL + compiler diagnostics.

## Phase 6 PRs

- [x] PR6.1: Unified rule plane API endpoints (list/create/update/disable/explain).
- [x] PR6.2: Web UI unification for guardrails/automations/preferences.
- [x] PR6.3: AI chat skills for rule management.

## Phase 7 PRs

- [ ] PR7.1: Decision/execution telemetry pipelines.
- [ ] PR7.2: Policy bypass and approval dead-end dashboards.
- [ ] PR7.3: Gate checks and rollout criteria automation.

## Completed Deliverables (Phase 1-6)

- [x] Canonical schema + migration adapters:
  - `CanonicalRule`, `CanonicalRuleVersion`, `PolicyDecisionLog`, `PolicyExecutionLog`.
  - Read-through adapters for legacy guardrails/automations/preferences.
- [x] Unified PDP enforcement:
  - Skills runtime mutation prechecks.
  - Planner mutation prechecks.
  - Automation and scheduled action execution paths.
- [x] Canonical automation executor:
  - Webhook and bulk processing wired to canonical automation evaluation.
  - Supported skip-action mode for archive-safe bulk passes.
- [x] Preference transforms:
  - Canonical preference rules converted and applied via PDP `allow_with_transform`.
  - Planner + skills honor transformed mutation payloads.
- [x] NL compiler + explain loop:
  - Compile preview endpoints and activation path.
  - Strict schema validation and clarification gating.
  - Source NL + compiler metadata persisted on canonical rules.
- [x] Unified management surfaces:
  - Rule-plane API (`/api/rule-plane`, `/api/rule-plane/compile`, `/api/rule-plane/[id]`).
  - Temporary unified UI panel for listing/previewing/activating/deleting rules.
  - `rule_plane_management` skill wired into skills runtime capabilities.
