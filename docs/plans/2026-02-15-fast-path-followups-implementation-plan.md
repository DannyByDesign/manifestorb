# 2026-02-15 Fast-Path Follow-Ups Implementation Plan

## Source Issue
- `docs/issues/2026-02-15-fast-path-followups.md`

## Objective
Close the two remaining production-readiness gaps from the fast-path rollout:
1. Make fast-path SLA compliance continuously measurable in production telemetry.
2. Allow plain-English rule disable/delete/update safely (no rule-id requirement), with fail-closed ambiguity handling.

## Scope
In scope:
- Fast-path telemetry schema + emissions + dashboard definitions.
- Model-led plain-English rule target selection for `policy.updateRule`, `policy.disableRule`, `policy.deleteRule`.
- Ambiguity-safe clarification fallback.
- Tests and rollout checks for both tracks.

Out of scope:
- New fast-path operations beyond current coverage matrix.
- Rule compiler behavior changes for create/list.
- Provider-level inbox/calendar API changes.

## Current State (Gap Map)

### A) SLA Telemetry Gap
What exists:
- Route selection telemetry: `openworld.runtime.route_selected` in:
  - `src/server/features/ai/runtime/attempt-loop.ts`
  - `src/server/features/ai/runtime/telemetry/schema.ts`
- Turn completion telemetry: `openworld.turn.completed` in:
  - `src/server/features/ai/runtime/index.ts`

What is missing for issue closure:
- A dedicated fast-path lifecycle event with outcome/fallback cause.
- Operation-level latency dimensions tied to fast-path reason/tool.
- Dashboard definitions for p50/p95/p99 by operation + provider split + fallback causes.

### B) Plain-English Rule Mutation Gap
What exists:
- Rule mutation capabilities require explicit `id` today:
  - `src/server/features/ai/tools/runtime/capabilities/policy.ts`
- Schemas force `id`:
  - `src/server/features/ai/tools/runtime/capabilities/registry.ts`

What is missing for issue closure:
- Safe plain-English target selection from available rules.
- Model-driven ambiguity detection and one-question clarification fallback.

## Design Decisions
1. Keep rule targeting simple and model-led:
- Do not introduce a dedicated standalone resolver module.
- Let the model reason over the fetched candidate rules.

2. Keep ID path as highest-priority path:
- If `id` is provided, use it directly.
- Model selection runs only when `id` is absent.

3. Fail closed on uncertainty:
- If model returns ambiguous/low-confidence/not-found, ask a clarification question.
- Never mutate a rule unless a single target is selected and validated against candidate set.

4. Telemetry remains first-class:
- Every strict/recovery fast-path attempt emits one structured event.
- Every fallback has explicit, enumerated cause.

## Phase Plan

### Phase 1: Fast-Path Telemetry Contract
Files:
- `src/server/features/ai/runtime/telemetry/schema.ts`
- `src/server/features/ai/runtime/attempt-loop.ts`

Changes:
1. Add event schema `openworld.runtime.fast_path` with fields:
- `userId`, `provider`
- `mode`: `strict | recovery`
- `reason` (operation reason)
- `toolName` (or `null` for direct respond)
- `decision`: `selected | skipped | executed | fallback`
- `outcome`: `success | incomplete | timeout | tool_error | not_admitted | unknown`
- `fallbackCause` enum:
  - `incomplete`
  - `timeout`
  - `tool_error`
  - `semantic_gate`
  - `slot_validation`
  - `tool_unavailable`
  - `not_matched`
- `latencyMs` (when execution happened)
- `truncated` (optional)
- `totalEstimate` (optional)
- `semanticConfidence` + `semanticMargin` (optional)

2. Emit telemetry in `runAttemptLoop` at:
- strict fast-path match selected
- strict/recovery tool execution success
- strict/recovery fallback paths (incomplete/timeout/tool_error)
- strict no-match / no-admission path

3. Ensure event payloads remain cardinality-safe:
- Reuse bounded string lengths for `reason/toolName`.
- Use enums for all outcome/fallback values.

Acceptance for Phase 1:
- Every fast-path turn produces a structured event.
- Fallbacks are machine-countable by cause.

---

### Phase 2: SLA Dashboard + Alert Spec
Files:
- `docs/plans/fast-path-sla-dashboard-spec.md` (new)

Changes:
1. Define dashboard panels required by issue:
- `p50/p95/p99 latency` grouped by `reason`
- `fallback rate` grouped by `fallbackCause`
- `provider split` (`google` vs `microsoft`) for latency and fallback

2. Define denominator/numerator formulas:
- fast-path attempts
- fast-path successful completions
- planner fallback rate from fast-path

3. Define alert thresholds (initial):
- p95 latency > 3s for 10m on covered operations
- fallback rate > 5% sustained for 15m
- provider-specific fallback spikes > 2x baseline

4. Define runbook checks in spec:
- top failing `reason`
- top fallback cause
- provider comparison deltas

Acceptance for Phase 2:
- Observability team/dev can build dashboards directly from event fields with no ambiguity.

---

### Phase 3: Model-Led Rule Target Selection (No Resolver Module)
Files:
- `src/server/features/ai/tools/runtime/capabilities/policy.ts`
- `src/server/features/policy-plane/service.ts` (read-only usage)

Changes:
1. Add local targeting helper in policy capability layer:
- Fetch candidate rules via `listRulePlaneRulesByType`.
- Build compact candidate list for model reasoning (id, name, type, enabled, description/source summary).

2. Add constrained model selection call:
- Prompt model with:
  - user target text
  - candidate rules
  - instruction to return `resolved | ambiguous | not_found`.
- Structured output schema includes:
  - `decision`
  - `selectedRuleId?`
  - `candidateRuleIds?`
  - `confidence?`

3. Add hard validation guardrails:
- Selected id must exist in candidate set.
- If decision is `ambiguous` or `not_found`, return clarification.
- If confidence below threshold (initial 0.75), return clarification.

4. Clarification behavior:
- Ask one direct question with top candidate names.
- No mutation executes until a single rule is confidently selected.

Acceptance for Phase 3:
- Users can refer to rules in plain English.
- Ambiguous requests reliably ask clarification rather than mutating.

---

### Phase 4: Wire Model-Led Targeting Into Rule Mutations
Files:
- `src/server/features/ai/tools/runtime/capabilities/policy.ts`
- `src/server/features/ai/tools/runtime/capabilities/registry.ts`

Changes:
1. Extend mutation tool input contracts:
- `policy.updateRule`: allow `id` OR `target` (+ existing patch)
- `policy.disableRule`: allow `id` OR `target`
- `policy.deleteRule`: allow `id` OR `target`
- optional `type` hint for candidate narrowing

2. Capability runtime behavior:
- If `id` provided: current path unchanged.
- If `target` provided: use model-led selector over fetched candidates.
- If selector returns ambiguous/not_found/low-confidence:
  - return `clarification` payload with one direct question.

3. Validation behavior:
- schema refinement requiring one of `id|target`.
- maintain backward compatibility for existing calls.

Acceptance for Phase 4:
- Users can mutate rules by plain English.
- System never performs wrong mutation from uncertain selection.

---

### Phase 5: Tests
Files:
- `src/server/features/ai/runtime/fast-path.test.ts`
- `src/server/features/ai/tools/runtime/capabilities/policy.targeting.test.ts` (new)

Test plan:
1. Fast-path telemetry:
- emits `openworld.runtime.fast_path` on success.
- emits explicit fallback causes for incomplete/timeout/tool_error.

2. Model-led rule targeting:
- single clear match resolves to target id.
- ambiguous case returns clarification.
- no-match returns clarification.
- selected id not in candidate list is rejected.

3. Capability integration:
- update/disable/delete by `target` executes with selected id.
- ambiguous/low-confidence selection does not mutate.

Acceptance for Phase 5:
- Regression-safe coverage for both issue outcomes.

---

### Phase 6: Cleanup + Rollout Validation
Files:
- `docs/issues/2026-02-15-fast-path-followups.md` (status update)

Steps:
1. Verify no standalone resolver module remains:
- remove `rule-target-resolver` artifacts if present and unused.

2. Deploy with telemetry enabled.

3. Validate 24h sample:
- latency panels populated by reason/provider.
- fallback causes present and sane.

4. Validate NL rule mutation manually:
- clear target phrase
- ambiguous phrase
- nonexistent target

5. Close issue when required outcomes are met.

## Execution Checklist

### Telemetry
- [ ] Add `openworld.runtime.fast_path` schema.
- [ ] Emit event for strict/recovery attempts and fallbacks.
- [ ] Ensure fallback causes are enum-bounded.
- [ ] Document dashboard panels and formulas.

### Rule Targeting (Model-Led)
- [ ] Implement model-led target selection in policy capability layer.
- [ ] Add candidate-set validation and confidence guard.
- [ ] Add clarification payload for ambiguous/not-found cases.
- [ ] Integrate into update/disable/delete flows.
- [ ] Update tool schemas to accept `id|target`.

### Cleanup + Release
- [ ] Remove standalone resolver files if any exist and are unused.
- [ ] Add/expand tests listed in Phase 5.
- [ ] Run targeted tests.
- [ ] Run full test/lint gates required for runtime changes.
- [ ] Update issue doc status + residual risks.

## Risks and Mitigations
1. Risk: model selects wrong rule.
- Mitigation: candidate-constrained structured output + id-in-candidate validation + confidence gate + clarification fallback.

2. Risk: telemetry cardinality blow-up.
- Mitigation: bounded reason/tool strings; enum fields for causes/outcomes.

3. Risk: provider-specific latency skew hides real SLA breaches.
- Mitigation: required provider split panels and alerts.

## Done Definition
The follow-up issue is complete when:
1. Fast-path SLA is continuously measurable with operation-level latency and fallback-cause visibility (including provider split).
2. Rule disable/delete/update support plain-English targeting using model-led candidate reasoning with safe clarification fallback.
3. Tests cover success + ambiguity + fallback paths, and issue status is updated accordingly.
