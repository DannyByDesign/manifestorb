# Capability-Graph Planner Fallback: Source of Truth

Status: Planned  
Owner: AI Runtime  
Scope: Inbox + Calendar autonomy breadth for long-tail requests  
Last Updated: 2026-02-13

## 1) Problem Statement

Current routing is intentionally closed-set to `BASELINE_SKILL_IDS`, and low-confidence turns are routed to clarification instead of execution planning. This blocks long-tail requests even when the underlying capabilities already exist.

Validated code anchors:

- Closed-set prompt constraint:
  - `src/server/features/ai/skills/router/router-prompts.ts:23`
- Closed-set type/schema boundary:
  - `src/server/features/ai/skills/baseline/skill-ids.ts:1`
  - `src/server/features/ai/skills/router/route-skill.ts:22`
- Clarification on low confidence:
  - `src/server/features/ai/skills/router/route-skill.ts:101`
  - `src/server/features/ai/skills/runtime.ts:206`
- Executor supports a broader capability set than baseline skill plans:
  - `src/server/features/ai/skills/executor/execute-skill.ts:69`

## 2) Product Goal

Preserve reliability/safety from skill contracts while adding an execution path for novel requests so users can ask for any supported inbox/calendar action in natural language.

Target behavior:

1. Baseline skills remain primary for high-confidence/common paths.
2. Novel-but-supported requests use planner fallback (not dead-end clarification loops).
3. Unsupported requests return explicit reason + next actionable user guidance.
4. No free-form tool calls in production. Everything remains schema-validated and policy-gated.

## 3) Hard Architecture Boundaries

1. LLM cannot directly execute tools.
2. All execution must go through:
   - typed capability registry
   - schema validation
   - policy/approval gate
   - idempotent executor
3. Planner output is structured JSON only.
4. No user-facing runtime mode toggles for this feature. This becomes default behavior once shipped.

## 4) Research Basis (Primary Sources)

- OpenAI Tools + function calling:
  - <https://platform.openai.com/docs/guides/tools>
  - <https://platform.openai.com/docs/guides/function-calling>
- OpenAI Agents execution patterns:
  - <https://openai.github.io/openai-agents-js/guides/running-agents/>
- Anthropic tool-use + effective agents:
  - <https://docs.anthropic.com/en/docs/build-with-claude/tool-use>
  - <https://www.anthropic.com/engineering/building-effective-agents>
- LangGraph workflows/interrupts (durable state + HITL):
  - <https://docs.langchain.com/oss/javascript/langgraph/workflows-agents>
  - <https://docs.langchain.com/oss/python/langgraph/interrupts>
- Semantic Kernel function-selection behaviors:
  - <https://learn.microsoft.com/en-us/semantic-kernel/concepts/ai-services/chat-completion/function-calling/function-choice-behaviors>
- ReAct planning/execution loop foundation:
  - <https://arxiv.org/abs/2210.03629>
- Surface primitives (grounded capability domain):
  - Gmail API: <https://developers.google.com/workspace/gmail/api/reference/rest>
  - Calendar API: <https://developers.google.com/workspace/calendar/api/v3/reference>

Inference: production-grade autonomy is achieved by constrained planning over typed capabilities, not by open-ended arbitrary tool invocation.

## 5) Execution Plan

## Phase 0: Contract and Success Definition

Objective: freeze acceptance criteria before implementation.

Tasks:

1. Define expected user outcomes for “ask anything within supported inbox/calendar scope.”
2. Define unsupported boundary response format.
3. Define rollout quality gates.

Deliverables:

- `docs/plans/capability-graph-quality-gates.md`
- `docs/plans/capability-graph-unsupported-boundary.md`

Exit Criteria:

1. Shared definitions approved and locked.
2. No implementation begins without these gates.

---

## Phase 1: Capability Registry Foundation

Objective: create one canonical capability surface for planner + executor.

Tasks:

1. Add registry entry per capability with:
   - `id`
   - `description`
   - `inputSchema`
   - `outputSchema`
   - `riskLevel`
   - `readOnly`
   - `approvalOperation`
   - `prerequisites`
   - `effects`
2. Add startup invariant:
   - every `EXECUTOR_SUPPORTED_CAPABILITIES` entry must exist in registry.
3. Normalize/remove legacy aliases not used by runtime.

Planned files:

- `src/server/features/ai/capabilities/registry.ts`
- `src/server/features/ai/capabilities/schemas.ts`
- `src/server/features/ai/capabilities/validator.ts`

Exit Criteria:

1. Build fails on missing metadata for any executor capability.
2. Capability args are schema-validated centrally.

---

## Phase 2: Router Expansion (Skill + Planner Route Types)

Objective: replace “clarify-only on long-tail” with planner fallback routing.

Tasks:

1. Extend route result to include:
   - `routeType: "skill" | "planner" | "clarify"`
2. Route policy:
   - `skill` if high-confidence mapped baseline path.
   - `planner` if intent is valid but no confident baseline skill.
   - `clarify` only if essential objective/target is missing.
3. Update router prompt and deterministic fallback logic accordingly.

Planned files:

- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/router/router-prompts.ts`

Exit Criteria:

1. Novel supported requests route to planner.
2. Clarification rate drops on long-tail phrasing.

---

## Phase 3: Candidate Capability Selection

Objective: keep planner search space small and relevant for precision/cost.

Tasks:

1. Build deterministic candidate selector (Top-K).
2. Rank by:
   - parsed intent families
   - entities/objects
   - action verbs
   - conversation/source context
3. Add bounded broadening pass if initial Top-K cannot validate.

Planned files:

- `src/server/features/ai/planner/select-capabilities.ts`
- `src/server/features/ai/planner/candidate-ranking.ts`

Exit Criteria:

1. Candidate set deterministic for same inputs.
2. Planner token/cost bounded by K and max broadening attempts.

---

## Phase 4: Capability-Graph Planner (Structured Plan Only)

Objective: generate validated execution plans for long-tail requests.

Tasks:

1. Define plan schema:
   - goal
   - steps[]
   - dependsOn[]
   - capability
   - args
   - postcondition
   - risk
2. Add plan validation:
   - known capabilities only
   - dependency graph acyclic
   - arg schema pass
   - max steps/complexity limits
   - preflight policy compatibility checks
3. Add one bounded repair pass on invalid plans.
4. If still invalid, produce targeted clarification request.

Planned files:

- `src/server/features/ai/planner/plan-schema.ts`
- `src/server/features/ai/planner/build-plan.ts`
- `src/server/features/ai/planner/validate-plan.ts`
- `src/server/features/ai/planner/repair-plan.ts`

Exit Criteria:

1. No unvalidated plan can execute.
2. Invalid plans never produce side effects.

---

## Phase 5: Deterministic Plan Executor

Objective: execute planner outputs with same safety properties as baseline skills.

Tasks:

1. Execute steps in topo order.
2. Per-step enforcement:
   - capability exists in registry
   - arg schema valid
   - policy/approval check
   - idempotency key generation
3. Support step result references for downstream steps.
4. Add bounded retries for transient provider failures.

Planned files:

- `src/server/features/ai/planner/execute-plan.ts`
- `src/server/features/ai/planner/step-context.ts`
- `src/server/features/ai/planner/result-normalizer.ts`

Exit Criteria:

1. Same request replay does not duplicate side effects.
2. All mutating steps pass approval/policy boundary.

---

## Phase 6: Multi-turn Continuation for Planner Path

Objective: robust long-tail clarifications without context loss.

Tasks:

1. Extend pending state model for planner runs:
   - pending plan
   - resolved args
   - missing args
   - step pointer
   - expiry
   - correlation id
2. Enforce message processing order:
   - pending decision handler
   - pending run-state continuation
   - preflight
   - routing (skill/planner)
3. Stateful argument merge before fresh reroute.

Planned files:

- `src/server/features/ai/message-processor.ts`
- `src/server/features/ai/planner/pending-plan-state.ts`
- Prisma migration(s) for planner state persistence

Exit Criteria:

1. Follow-up fragments (“tomorrow at 3”) resume active plan reliably.
2. Context is not dropped between clarification turns.

---

## Phase 7: Coverage Expansion (“Do Everything” within Supported Surface)

Objective: ensure all supported inbox/calendar operations are reachable.

Tasks:

1. Build capability coverage matrix:
   - API primitive
   - capability
   - baseline skill coverage
   - planner fallback coverage
2. Fill missing high-value capabilities and metadata.
3. Ensure approval operation mappings exist for all mutating capabilities.

Planned files:

- `docs/plans/capability-coverage-matrix.md`
- `src/server/features/ai/capabilities/*.ts`
- `src/server/features/ai/capabilities/registry.ts`

Exit Criteria:

1. Every supported surface operation has at least one executable path.
2. Unsupported operations are explicit and user-visible.

---

## Phase 8: Telemetry, Evals, and Rollout Gates

Objective: ship safely while increasing autonomy breadth.

Tasks:

1. Add telemetry fields:
   - routeType
   - candidateCount
   - planValidationFailureReason
   - repairCount
   - policyBlockReason
   - clarificationDepth
   - userCorrectionSignal
2. Add long-tail scenario harness for realistic phrasing variance.
3. Gate rollout by behavioral metrics.

Planned files:

- `src/server/features/ai/skills/telemetry/emit.ts`
- `scripts/skills-scenario-harness.ts`
- `docs/plans/capability-graph-quality-gates.md`

Exit Criteria:

1. Long-tail task success increases without safety regression.
2. Incorrect-action rate does not regress.

## 6) Edge Cases (Must Handle)

1. Ambiguous destructive requests:
   - require clarification and/or approval before side effects.
2. Cross-surface multi-intent requests:
   - split into graph steps with dependencies.
3. Missing provider scope:
   - classify as provider/permissions error; no silent failure.
4. Duplicate/out-of-order events from sidecars:
   - idempotency + correlation key de-dupe.
5. Partial follow-up answers:
   - merge into pending state; do not restart plan unnecessarily.
6. Rule/policy conflicts:
   - block with reason + safe alternative suggestion.

## 7) Quality Gates

Minimum ship bar:

1. Long-tail supported-task success rate: >= 90% (initial), target 95%.
2. Incorrect action rate: <= 2%.
3. Clarification-loop rate (2+ consecutive clarifications): <= 5%.
4. User correction within 10 minutes: <= 5%.
5. Safety violations: 0.

## 8) Out of Scope for This Plan

1. Domain-specific vertical skill packs.
2. Rule-system redesign (future overhaul); only integration alignment included here.
3. Broad test-suite expansion beyond targeted runtime/eval harness needed for this migration.

## 9) Implementation Order (Mandatory)

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8

Do not skip ahead. Each phase requires explicit exit criteria verification before moving on.

