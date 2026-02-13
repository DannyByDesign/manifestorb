# OpenClaw Runtime Transplant - Phased Execution Breakdown

This document is the implementation companion to:
- `docs/plans/openclaw-runtime-transplant/OPENCLAW_RIP_REPLACE_EPIC.md`

It converts each epic into concrete work packages with explicit code touch points.

## Phase 1 - Runtime Kernel Cutover
### P1-W1: Introduce runtime module
- Add:
  - `src/server/features/ai/runtime/session.ts`
  - `src/server/features/ai/runtime/attempt.ts`
  - `src/server/features/ai/runtime/loop.ts`
  - `src/server/features/ai/runtime/response.ts`
  - `src/server/features/ai/runtime/index.ts`
- Replace call site:
  - `src/server/features/ai/message-processor.ts`

### P1-W2: Remove preflight as hard stop
- Update:
  - `src/server/features/ai/orchestration/preflight.ts` (or remove from critical path)
- Ensure runtime continues without preflight success.

### P1 DoD
- Inbound Slack/web messages execute through `ai/runtime/*` path.
- No hard failure path that returns “cannot build execution plan.”

## Phase 2 - Tool Fabric
### P2-W1: Tool registry + assembly
- Add:
  - `src/server/features/ai/tools/fabric/registry.ts`
  - `src/server/features/ai/tools/fabric/assembler.ts`
  - `src/server/features/ai/tools/fabric/policy-filter.ts`
  - `src/server/features/ai/tools/fabric/types.ts`

### P2-W2: Provider-safe schema adapter
- Add:
  - `src/server/features/ai/tools/fabric/adapters/provider-schema.ts`
- Replace schema generation in runtime path to use static-compatible structures.

### P2-W3: Unsupported-intent telemetry foundation
- Add:
  - `src/server/features/ai/runtime/telemetry/unsupported-intents.ts`
- Emit normalized unsupported-intent pattern keys when planner cannot map request segments to tools.

### P2 DoD
- Runtime builds toolset dynamically per request.
- Provider schema rejects are eliminated for known tool contracts.

## Phase 3 - Internal Skill MD Hints
### P3-W1: Skill format + loader
- Add:
  - `src/server/features/ai/skills/loader.ts`
  - `src/server/features/ai/skills/snapshot.ts`
  - `src/server/features/ai/skills/selector.ts`
  - `src/server/features/ai/skills/types.ts`
- Update prompt builder:
  - `src/server/features/ai/system-prompt.ts`

### P3-W2: Internalize skill corpus
- Keep skills under repo `skills/` only.
- Prohibit loading skills from external repos/paths.

### P3 DoD
- Skills provide prompt guidance only; not hard routing.

## Phase 4 - Open-World Planner/Executor
### P4-W1: New planner package
- Add:
  - `src/server/features/ai/runtime/planner/plan-draft.ts`
  - `src/server/features/ai/runtime/planner/plan-validate.ts`
  - `src/server/features/ai/runtime/planner/plan-execute.ts`
  - `src/server/features/ai/runtime/planner/plan-repair.ts`
  - `src/server/features/ai/runtime/planner/types.ts`

### P4-W2: Replace legacy planner entry points
- Replace usage from:
  - `src/server/features/ai/planner/runtime.ts`
  - `src/server/features/ai/planner/build-plan.ts`
  - `src/server/features/ai/planner/select-capabilities.ts`
- New runtime invokes `runtime/planner/*` directly.

### P4-W3: Ambiguity and repair controls
- Add:
  - `src/server/features/ai/runtime/planner/ambiguity-resolver.ts`
  - `src/server/features/ai/runtime/planner/clarification-policy.ts`
  - `src/server/features/ai/runtime/planner/validator.ts`
- Behavior:
  - one-turn clarification on low-confidence entity resolution
  - one repair pass from deterministic validator feedback
  - fallback to explicit partial-result response instead of hard failure

### P4 DoD
- Planner chooses tools from tool fabric without requiring capability-family match.

## Phase 5 - Rule Plane Enforcement Consolidation
### P5-W1: Single enforcement adapter
- Add:
  - `src/server/features/ai/policy/enforcement.ts`
- Connect to:
  - `src/server/features/policy-plane/pdp.ts`
  - `src/server/features/policy-plane/service.ts`

### P5-W2: Hook policy checks into tool execution
- Update tool executor path (runtime planner execution loop).
- Ensure every mutating tool call receives a decision envelope.

### P5 DoD
- Rule plane is the only authority for allow/deny/approval on actions.

## Phase 6 - Inbox/Calendar Domain Primitives
### P6-W1: Email primitives
- Add/normalize under:
  - `src/server/features/ai/tools/email/*`
- Migrate from:
  - `src/server/features/ai/tools/providers/email.ts`

### P6-W2: Calendar primitives
- Add/normalize under:
  - `src/server/features/ai/tools/calendar/*`
- Migrate from:
  - `src/server/features/ai/tools/providers/calendar.ts`

### P6-W3: Shared rate-limit and retry control
- Add:
  - `src/server/features/ai/tools/common/retry.ts`
  - `src/server/features/ai/tools/common/throttle.ts`
  - `src/server/features/ai/tools/common/idempotency.ts`

### P6-W4: Context hydration and auth/scope prechecks
- Add:
  - `src/server/features/ai/runtime/context/hydrator.ts`
  - `src/server/features/ai/runtime/context/requirements.ts`
  - `src/server/features/ai/runtime/context/precheck.ts`
- Enforce per-tool context requirement contracts before execution.

### P6 DoD
- Basic and compound inbox/calendar requests execute via primitives with bounded concurrency.

## Phase 7 - Capability Expansion Framework
### P7-W1: Internal pack system
- Add:
  - `src/server/features/ai/tools/packs/manifest-schema.ts`
  - `src/server/features/ai/tools/packs/loader.ts`
  - `src/server/features/ai/tools/packs/registry.ts`

### P7-W2: Pack onboarding contract
- Add per-pack manifest + tool modules.
- Include startup validation for duplicate tool names.

### P7 DoD
- New capability domains can be added without planner rewrites.

## Phase 8 - Legacy Runtime Deletion
### P8-W1: Delete old capability catalog path
- Remove:
  - `src/server/features/ai/capabilities/*`

### P8-W2: Delete legacy skills router/executor path
- Remove:
  - `src/server/features/ai/skills/router/*`
  - `src/server/features/ai/skills/executor/*`
  - `src/server/features/ai/skills/runtime.ts` (legacy form)

### P8-W3: Remove legacy planner path
- Remove:
  - `src/server/features/ai/planner/*`

### P8 DoD
- One runtime path remains. No dual execution systems.

## Phase 9 - Rules Legacy Consolidation
### P9-W1: Remove duplicate legacy rules engine
- Remove (after parity confirmation with policy-plane):
  - `src/server/features/rules/**`

### P9-W2: Route all automation logic to policy-plane
- Keep and extend:
  - `src/server/features/policy-plane/automation-executor.ts`

### P9-W3: Low-hanging reliability gates
- Add runtime gates for:
  - unsupported-intent trend alerting
  - ambiguity-clarification success rate
  - provider 429 rate and retry exhaustion
  - context-precheck failure categories
- Fail release promotion if basic thresholds regress.

### P9 DoD
- Rule plane exclusively handles permissions/automations/preferences.

## Phase 10 - Operational Cutover
### P10-W1: Performance and reliability gates
- Add runtime metrics for:
  - `request_latency_ms`
  - `plan_build_ms`
  - `tool_call_ms`
  - `tool_error_rate`
  - `provider_429_rate`

### P10-W2: Production cutover
- Remove final feature flags for legacy architecture.
- Ship only new runtime.

### P10 DoD
- Production runs entirely on transplanted architecture.

---

## Schema Contract Checklist (Apply Each Phase)
- No empty `object` schemas in provider response-schema trees.
- No numeric enum values represented as strings where provider expects numeric type.
- No zod transform-derived runtime schemas in provider request payloads.
- Every tool has:
  - static input schema
  - static output schema
  - schema version
- Startup fails if any schema contract is invalid.

## Dependency Order
1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9
10. Phase 10

## Critical Anti-Patterns To Avoid
- Reintroducing closed capability-family gates.
- Keeping legacy planner “just in case.”
- Allowing external third-party skill markdown imports.
- Bypassing rule-plane checks in any mutating tool.

## Implementation Principle
If a module is replaced, delete the old module in the same phase unless removal blocks current rollout. Keep the codebase singular and coherent.
