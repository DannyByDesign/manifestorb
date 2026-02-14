# 2026-02-14 OpenClaw Tool Harness 1:1 Cutover Plan (Source of Truth)

Status: Implemented
Owner: AI Runtime
Scope: Replace amodel tool harness/loop with OpenClaw-equivalent harness while preserving amodel rule/policy enforcement semantics.

## 1. Objective

Replace amodel's current tool harness and loop implementation with a 1:1 OpenClaw-style harness:

- provider-native agent session loop
- custom tool definitions adapter
- OpenClaw-equivalent tool lifecycle event model
- OpenClaw-equivalent deterministic policy filter order

while keeping amodel-specific rule-plane behavior (blocking, approvals, mutations policy) intact.

## 2. Hard Constraints

1. Keep rule system intact.
2. No deterministic response templates added by this migration.
3. No permanent dual runtime path after cutover (temporary migration scaffolding allowed only during implementation).
4. Preserve current approval artifacts and interactive payload behavior.
5. Preserve existing semantic classifier stage (semantic-before-gate) as agreed.

## 3. Audit Summary (amodel vs OpenClaw)

## 3.1 Current amodel harness shape

- Runtime uses AI SDK `generate(...)` with `tools: session.tools` in loop:
  - `src/server/features/ai/runtime/attempt-loop.ts:401`
- Tools assembled as `ToolSet` with inline execution wrappers:
  - `src/server/features/ai/tools/fabric/assembler.ts:99`
- Policy enforcement is embedded in tool execution wrapper:
  - `src/server/features/ai/tools/fabric/assembler.ts:123`

## 3.2 OpenClaw harness shape (target)

- Tools are transformed to provider-facing `ToolDefinition[]` via adapter:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-tool-definition-adapter.ts:26`
- SDK tool split always routes to `customTools`:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/tool-split.ts:9`
- Agent loop created through provider-native session:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:450`
- Prompt execution done through active session (`activeSession.prompt(...)`):
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run/attempt.ts:782`

## 3.3 Key parity gaps to close

1. Harness mechanism mismatch:
- amodel: inline `ToolSet` wrappers
- OpenClaw: adapter + customTools + agent session

2. Filter behavior mismatch:
- amodel includes semantic ranking/limits inside filter function (`scoreToolRelevance`, `PROFILE_LIMITS`)
- OpenClaw filter is deterministic layered policy chain only

3. Policy matcher edge behavior missing in amodel:
- `apply_patch` allowed when `exec` is allowlisted:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.policy.ts:52`
- plugin-only allowlist stripping and warnings:
  - `/Users/dannywang/Projects/openclaw/src/agents/tool-policy.ts:187`

4. Subagent baseline deny parity missing in amodel:
- OpenClaw default subagent deny list:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-tools.policy.ts:57`

5. Tool lifecycle event shape not fully mirrored:
- OpenClaw emits `tool` stream phases `start|update|result` with `toolCallId`:
  - `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-subscribe.handlers.tools.ts:63`

## 4. OpenClaw Reference Snippets (Canonical)

## 4.1 Tool split to customTools

```ts
// /openclaw/src/agents/pi-embedded-runner/tool-split.ts
export function splitSdkTools(options: { tools: AnyAgentTool[]; sandboxEnabled: boolean }): {
  builtInTools: AnyAgentTool[];
  customTools: ReturnType<typeof toToolDefinitions>;
} {
  const { tools } = options;
  return {
    builtInTools: [],
    customTools: toToolDefinitions(tools),
  };
}
```

## 4.2 Provider-native session setup

```ts
// /openclaw/src/agents/pi-embedded-runner/run/attempt.ts
({ session } = await createAgentSession({
  cwd: resolvedWorkspace,
  agentDir,
  model,
  systemPrompt,
  tools: builtInTools,
  customTools: allCustomTools,
  sessionManager,
  settingsManager,
  skills: [],
  contextFiles: [],
}));
```

## 4.3 Deterministic layered filtering order

```ts
// /openclaw/src/agents/pi-tools.ts
const toolsFiltered = profilePolicyExpanded ? filterToolsByPolicy(tools, profilePolicyExpanded) : tools;
const providerProfileFiltered = providerProfileExpanded
  ? filterToolsByPolicy(toolsFiltered, providerProfileExpanded)
  : toolsFiltered;
const globalFiltered = globalPolicyExpanded
  ? filterToolsByPolicy(providerProfileFiltered, globalPolicyExpanded)
  : providerProfileFiltered;
const globalProviderFiltered = globalProviderExpanded
  ? filterToolsByPolicy(globalFiltered, globalProviderExpanded)
  : globalFiltered;
const agentFiltered = agentPolicyExpanded
  ? filterToolsByPolicy(globalProviderFiltered, agentPolicyExpanded)
  : globalProviderFiltered;
const agentProviderFiltered = agentProviderExpanded
  ? filterToolsByPolicy(agentFiltered, agentProviderExpanded)
  : agentFiltered;
const groupFiltered = groupPolicyExpanded
  ? filterToolsByPolicy(agentProviderFiltered, groupPolicyExpanded)
  : agentProviderFiltered;
const sandboxed = sandboxPolicyExpanded
  ? filterToolsByPolicy(groupFiltered, sandboxPolicyExpanded)
  : groupFiltered;
const subagentFiltered = subagentPolicyExpanded
  ? filterToolsByPolicy(sandboxed, subagentPolicyExpanded)
  : sandboxed;
```

## 4.4 Tool lifecycle events

```ts
// /openclaw/src/agents/pi-embedded-subscribe.handlers.tools.ts
emitAgentEvent({
  runId,
  stream: "tool",
  data: { phase: "start", name: toolName, toolCallId, args },
});

emitAgentEvent({
  runId,
  stream: "tool",
  data: { phase: "update", name: toolName, toolCallId, partialResult },
});

emitAgentEvent({
  runId,
  stream: "tool",
  data: { phase: "result", name: toolName, toolCallId, isError, result },
});
```

## 5. Target Architecture in amodel

## 5.1 What changes

- Replace current `ToolSet`-centric execution harness with OpenClaw-equivalent adapter + provider-native custom tools loop.
- Move tool execution wrapper responsibilities into adapter-executed tool handlers.
- Keep deterministic policy filter chain as pre-session exposure gate.
- Keep semantic stage before deterministic gate.

## 5.2 What stays

- `enforcePolicyForTool(...)` rule-plane contract.
- approval artifact model and persistence behavior.
- interactive payload behavior.
- semantic classifier + route profile selection.

## 6. File Mapping Plan (1:1 Mirror)

## 6.1 New/rewired amodel modules

1. `src/server/features/ai/tools/harness/tool-definition-adapter.ts`
- mirror of OpenClaw `pi-tool-definition-adapter.ts`

2. `src/server/features/ai/tools/harness/tool-split.ts`
- mirror of OpenClaw `pi-embedded-runner/tool-split.ts`

3. `src/server/features/ai/runtime/harness/session-runner.ts`
- mirror of OpenClaw `createAgentSession + activeSession.prompt` orchestration

4. `src/server/features/ai/runtime/harness/tool-events.ts`
- mirror of OpenClaw tool lifecycle emitters (`start/update/result`)

5. `src/server/features/ai/tools/policy/*`
- align remaining behavior gaps (`apply_patch` compatibility, plugin-only allowlist stripping, subagent defaults)

## 6.2 Existing amodel modules to replace/refactor

- `src/server/features/ai/runtime/attempt-loop.ts` (major rewrite)
- `src/server/features/ai/tools/fabric/assembler.ts` (decompose/remove ToolSet wrapper path)
- `src/server/features/ai/tools/fabric/policy-filter.ts` (split semantic stage vs deterministic chain)

## 7. Detailed Phase Plan

## Phase A: Isolate deterministic gate from semantic narrowing

Goal: Make deterministic gate identical to OpenClaw chain; keep semantic stage as a separate pre-gate stage.

Tasks:
1. Split `policy-filter.ts` into:
- `semantic-tool-candidate.ts` (semantic narrowing + scoring, if retained)
- `deterministic-policy-filter.ts` (strict OpenClaw order only)
2. Ensure deterministic stage has no ranking/limits.
3. Apply ranking/limits only as optional post-policy ordering module (outside deterministic gate).

Acceptance:
- Deterministic filter function can be line-by-line compared with OpenClaw chain order.

## Phase B: Add missing OpenClaw policy semantics

Tasks:
1. Add `apply_patch` compatibility:
- if allowlist matches `exec`, treat `apply_patch` as allow.
2. Add plugin-only allowlist stripping behavior:
- mirror `stripPluginOnlyAllowlist` semantics.
3. Add unknown allowlist diagnostics.
4. Add default subagent deny baseline and merge with user subagent deny.

Acceptance:
- New parity tests covering all above behaviors.

## Phase C: Implement OpenClaw-style tool-definition adapter

Tasks:
1. Create `tool-definition-adapter.ts` to convert internal runtime tool definitions into provider custom tool definitions.
2. Preserve execution error behavior and abort semantics.
3. Wrap tool execution with existing `enforcePolicyForTool(...)` before invoking tool executor.
4. Preserve argument validation + clarification behavior.

Acceptance:
- Adapter returns provider-consumable definitions and executes with rule enforcement.

## Phase D: Replace loop engine with provider-native session loop

Tasks:
1. Build `session-runner.ts` around provider-native session creation and `session.prompt(...)` execution.
2. Route tool definitions through `customTools` (built-in tools empty unless explicitly needed).
3. Remove direct AI SDK `tools: session.tools` dependence from core loop.
4. Keep timeout and budget controls but enforce them around session-runner invocation.

Acceptance:
- Main runtime loop no longer directly uses `ToolSet` wrappers for execution.

## Phase E: Tool lifecycle parity

Tasks:
1. Emit `start/update/result` with stable `toolCallId` for every tool call.
2. Keep current telemetry schema, but add parity-compatible event payload fields.
3. Wire lifecycle events into approvals/interactive summaries.

Acceptance:
- Event stream includes all tool phases with IDs and outcomes.

## Phase F: Preserve rule-plane behavior in new harness

Tasks:
1. Move policy enforcement call from `assembler.ts` into adapter execution wrapper.
2. Keep approval creation path unchanged.
3. Keep blocked/clarification result contracts unchanged.

Acceptance:
- Mutation guardrails remain identical pre/post migration.

## Phase G: Cutover and delete legacy harness

Tasks:
1. Switch runtime entrypoint to new session-runner path.
2. Delete obsolete ToolSet harness files and dead paths.
3. Update docs (`src/server/features/ai/README.md`) to new architecture only.

Acceptance:
- Single harness path in production runtime.

## 8. Test Strategy

## 8.1 Parity tests (must add)

1. Policy matcher parity
- wildcard/deny precedence
- `apply_patch` via `exec` allow
- plugin-only allowlist stripping
- subagent default deny

2. Harness parity
- tool definition adapter executes tool and returns normalized result
- lifecycle emits `start/update/result` with same call ID

3. Rule preservation
- blocked policy returns blocked contract
- approval-required returns approval artifact
- allowed mutation executes

## 8.2 Regression smoke checks

1. Greeting message uses no tool and responds quickly.
2. "first email in inbox" completes in one short turn.
3. "meetings today" uses calendar read tools only.
4. mutation request triggers approval/rule behavior.

## 9. Rollout and Safety

1. Implement behind code-level migration branch only (no long-term feature flag).
2. Run full test and lint/typecheck before cutover commit.
3. Cut over in one merge once parity tests pass.
4. Remove legacy harness code in same cutover window to prevent drift.

## 10. Definition of Done

1. Runtime tool loop is provider-native session-driven (OpenClaw-equivalent).
2. Tool definitions are adapter-based, not monolithic ToolSet wrappers.
3. Deterministic policy filtering order matches OpenClaw exactly.
4. Missing OpenClaw policy semantics (`apply_patch`, plugin stripping, subagent defaults) are present.
5. Rule-plane behavior is preserved and validated.
6. Legacy harness path removed.

## 11. Implementation Checklist

- [x] A1 split semantic pre-stage from deterministic filter chain
- [x] B1 add `apply_patch`/`exec` compatibility behavior
- [x] B2 add plugin-only allowlist stripping + diagnostics
- [x] B3 add default subagent deny baseline
- [x] C1 add tool-definition adapter module
- [x] C2 port execution error/abort behavior to adapter
- [x] D1 add provider-native session runner
- [x] D2 replace `attempt-loop.ts` harness internals
- [x] E1 add tool lifecycle parity emitter
- [x] F1 move `enforcePolicyForTool` into adapter execution wrapper
- [x] G1 remove legacy ToolSet harness path
- [x] G2 update runtime docs to final architecture
- [x] G3 run test/lint/typecheck gates

## 13. Execution Notes

- Completed harness cutover modules:
  - `src/server/features/ai/tools/harness/tool-definition-adapter.ts`
  - `src/server/features/ai/tools/harness/tool-split.ts`
  - `src/server/features/ai/runtime/harness/session-runner.ts`
  - `src/server/features/ai/runtime/harness/tool-events.ts`
- Runtime now uses harness path via:
  - `src/server/features/ai/runtime/session.ts`
  - `src/server/features/ai/runtime/attempt-loop.ts`
  - `src/server/features/ai/runtime/tool-runtime.ts`
- Legacy path removed:
  - deleted `src/server/features/ai/tools/fabric/assembler.ts`
- Added parity tests for matcher/policy/harness lifecycle.
- Quality gate summary during implementation:
  - Targeted runtime/harness/policy tests passed.
  - `bun run build` passed (webpack warnings only).
  - Full-repo `bun test-ai` and `bun lint` still report pre-existing unrelated failures outside runtime harness scope.

## 12. Notes for Execution

- This plan intentionally does not alter higher-level product behavior, prompts, or personality.
- This plan is strictly harness/filter parity + rule preservation.
- If any OpenClaw behavior conflicts with existing rule-plane guarantees, rule-plane guarantees win and parity adaptation is documented inline.
