# Cloud Agent SDK Secretary Runtime V2: Full Migration Plan

**Status:** Planning complete, implementation not started  
**Date:** 2026-02-24  
**Scope:** Entire `src` tree (862 files, ~128,302 LOC)  
**Directive:** Replace unreliable custom orchestration with a TypeScript Agent-SDK-style runtime, preserve strong domain/runtime capabilities, and narrow product scope to conversational inbox/calendar secretary.

## 1. Decision

This plan adopts a **full runtime migration**, not incremental patching.

1. Replace the current custom orchestration core (`turn-compiler`, `router`, `attempt-loop`, deterministic planner branches) with an Agent-SDK-style session/query kernel in TypeScript.
2. Keep and harden the mature provider/domain surfaces that already exist (email/calendar/task/policy adapters), but expose them through SDK-style MCP tool contracts.
3. Reduce runtime scope to secretary outcomes only (inbox + calendar + conversational thought partner), and remove/prune runtime paths that dilute reliability.
4. Keep policy/approval enforcement as a first-class invariant.
5. Ship with observability and rollback gates tied to measurable reliability SLOs.

## 2. Why Full Replacement Is Required (Code Diagnosis)

The current architecture has multiple overlapping planners and rewrite layers that increase nondeterminism and failure odds.

1. Custom turn classification and routing stack is large and brittle.
   - `src/server/features/ai/runtime/turn-compiler.ts:1`
   - `src/server/features/ai/runtime/turn-contract.ts:1`
   - `src/server/features/ai/runtime/router.ts:1`
2. Runtime execution is multi-lane + fallback-heavy, not a single stable session model.
   - `src/server/features/ai/runtime/attempt-loop.ts:278`
3. Deterministic cross-surface planner adds another orchestration path and model call surface.
   - `src/server/features/ai/runtime/deterministic-cross-surface.ts:1`
4. Tool lifecycle currently spans multiple adapter layers (policy adapter + harness + split + runtime execution), increasing integration surface area.
   - `src/server/features/ai/tools/harness/tool-definition-adapter.ts:1`
   - `src/server/features/ai/tools/harness/tool-split.ts:1`
   - `src/server/features/ai/runtime/tool-runtime.ts:1`
5. Search/retrieval responsibilities are split between unified search and capability/provider filtering paths.
   - `src/server/features/ai/tools/runtime/capabilities/email.ts:184`
   - `src/server/features/search/unified/service.ts:1`

User-reported failure modes (email search misses, reschedule misses) align with this complexity profile.

## 3. Research Inputs Used

### 3.1 Agent SDK Documentation (Primary)

1. Agent SDK overview: [platform.claude.com/docs/agent-sdk/overview](https://platform.claude.com/docs/agent-sdk/overview)
2. Sessions and state: [platform.claude.com/docs/agent-sdk/sessions](https://platform.claude.com/docs/agent-sdk/sessions)
3. Permissions and user input: [platform.claude.com/docs/agent-sdk/permissions-user-input](https://platform.claude.com/docs/agent-sdk/permissions-user-input)
4. Hooks: [platform.claude.com/docs/agent-sdk/hooks](https://platform.claude.com/docs/agent-sdk/hooks)
5. Skills: [platform.claude.com/docs/agent-sdk/skills](https://platform.claude.com/docs/agent-sdk/skills)
6. Subagents: [platform.claude.com/docs/agent-sdk/subagents](https://platform.claude.com/docs/agent-sdk/subagents)
7. MCP: [platform.claude.com/docs/agent-sdk/mcp](https://platform.claude.com/docs/agent-sdk/mcp)
8. TypeScript SDK reference: [docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)
9. Cost tracking: [platform.claude.com/docs/agent-sdk/tracking-costs](https://platform.claude.com/docs/agent-sdk/tracking-costs)
10. Programmatic tool use: [docs.claude.com/en/docs/agents-and-tools/tool-use/implement-tool-use](https://docs.claude.com/en/docs/agents-and-tools/tool-use/implement-tool-use)
11. Tool helpers: [docs.claude.com/en/docs/agents-and-tools/tool-use/tool-helpers](https://docs.claude.com/en/docs/agents-and-tools/tool-use/tool-helpers)

### 3.2 Agent SDK Source (Primary)

1. Python `tool(...)` and `create_sdk_mcp_server(...)` patterns:
   - `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/__init__.py:90`
   - `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/__init__.py:157`
2. Python `ClaudeAgentOptions` surface:
   - `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/types.py:716`
3. Python `query(...)` and stateful `ClaudeSDKClient`:
   - `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/query.py:12`
   - `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/client.py:14`
4. TypeScript SDK options/query/control API:
   - `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:476`
   - `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:1028`
   - `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:1166`
   - `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:257`
   - `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:269`

### 3.3 OpenClaw References (Context)

1. Framework positioning and runtime emphasis: [openclaw.im](https://openclaw.im)
2. Runtime architecture language (LLM + instructions + runtime + tools): [docs.openclaw.ai](https://docs.openclaw.ai)

### 3.4 YouTube Transcript Inputs (Requested)

Transcripts were programmatically fetched and analyzed for:
1. [youtube.com/watch?v=_h2EnRfxMQE](https://www.youtube.com/watch?v=_h2EnRfxMQE)
2. [youtube.com/watch?v=3wglqgskzjQ](https://www.youtube.com/watch?v=3wglqgskzjQ)

Key extracted points used in this plan:
1. Agents are fundamentally looped tool-use runtimes; reliability depends on runtime/tool contract discipline (around 03:15 in video 1).
2. SDK value is mature default tools + proven runtime behavior, not just model selection.
3. Programmatic tool use and sandboxed execution can reduce repetitive tool-call ping-pong for complex workflows (video 2).

## 4. Full `src` Coverage Mapping (Line-Level Authority)

This plan uses three appendices as the authoritative mapping set.

1. Full file-level line-span map (all 862 files):
   - `docs/plans/appendix/2026-02-23-secretary-v2-src-map.csv`
2. Module matrix across all `src` files:
   - `docs/plans/appendix/2026-02-23-secretary-v2-module-matrix.md`
3. Exhaustive heavy-change/prune list (277 files):
   - `docs/plans/appendix/2026-02-23-secretary-v2-heavy-change-files.md`

Interpretation rule for implementation:
1. `line_span` is authoritative (`1-N` per file).
2. `action` field determines treatment (`modify`, `keep+adapt`, `prune`, etc.).
3. No file in `src` is out of scope.

## 5. Current Action Inventory (From Mapping)

### 5.1 Action buckets

1. `MODIFY_V2_CORE`: 53 files / 8,488 lines
2. `MODIFY_V2_TOOLING`: 112 files / 17,218 lines
3. `MODIFY_V2_WIRING`: 34 files / 4,394 lines
4. `PRUNE_OR_DEFER_NON_SECRETARY`: 54 files / 8,708 lines
5. `PRUNE_FROM_SECRETARY_MODE`: 24 files / 6,611 lines
6. `KEEP_*` buckets (with hardening/interface/telemetry changes): remaining files

### 5.2 Module footprint

Largest high-impact modules by lines:
1. `src/server/features` (74,198 LOC)
2. `src/server/lib` (18,219 LOC)
3. `src/server/integrations` (12,106 LOC)
4. `src/app/api` (9,780 LOC)

## 6. LLM-Skills-Tools Interplay (Current vs Target)

### 6.1 Current interplay in this repository

1. LLM role is split across multiple orchestration calls:
   - intent/contract compiler
   - routing/planning
   - response rewriting
2. Skills are selected heuristically by message keyword scoring:
   - `src/server/features/ai/skills/snapshot.ts:6`
3. Tools are represented as internal capability definitions, then transformed through multiple runtime adapters:
   - `registry -> policy filter -> harness adapter -> runtime executor`
4. Result: high flexibility, but too many orchestration boundaries where reliability can degrade.

### 6.2 Target interplay with Agent-SDK-style model

1. LLM role is consolidated into one session runtime with consistent tool-calling semantics.
2. Skills are runtime-configured context assets/subagents, not ad-hoc scoring artifacts.
3. Tools are MCP-registered contracts with one policy gate (`PreToolUse`) and one result lifecycle (`PostToolUse` / failure hook).
4. Result: fewer decision boundaries, better determinism, simpler debugging.

## 7. Python SDK -> TypeScript Porting Spec

The upstream SDK repository is Python-first, but our runtime is TypeScript. This plan ports concepts, not language syntax.

### 7.1 Concept translation map

1. Python `@tool(...)` decorator -> TypeScript tool registration object/factory.
2. Python `create_sdk_mcp_server(...)` -> TypeScript `createSdkMcpServer(...)`.
3. Python `ClaudeAgentOptions` dataclass -> TypeScript `AgentOptions` interface + Zod validation at boundaries.
4. Python async generator query/client -> TypeScript async iterator query/session controller.
5. Python hook matcher schema -> TypeScript hook matcher config with typed callback contracts.

### 7.2 Repository implementation points for translation

1. Tool definition translation:
   - from `src/server/features/ai/tools/runtime/capabilities/registry.ts:152`
   - to new MCP registration module in `src/server/features/ai/runtime/*` (new files)
2. Session option translation:
   - from runtime policy/router knobs
   - to one options builder consumed by session start
3. Stream/session control translation:
   - from `attempt-loop` custom control flow
   - to query/session control API wrapper (`interrupt`, permission mode, dynamic MCP)

## 8. Target Architecture (TypeScript Agent SDK Model)

### 8.1 Runtime model

Replace custom runtime orchestration with a single session-based kernel:
1. Session starts with explicit `options` (tools, model, permissions, hooks, budget).
2. Session streams messages/tool calls as first-class events.
3. Tool admission and policy checks happen through one permission pipeline.
4. Tool surfaces are provided via MCP server definitions (in-process for local domain tools).
5. Context/skills are injected through controlled pre-turn/hook pathways.

### 8.2 Secretary scope boundary

In runtime mode, supported intent families are restricted to:
1. Conversational/thought-partner turns.
2. Inbox read/mutate/composition.
3. Calendar read/mutate/reschedule.
4. Approval/policy clarifications tied to inbox/calendar tasks.

Everything else is either:
1. Deferred to non-secretary workflows, or
2. Pruned from secretary runtime mode.

## 9. Agent SDK Patterns To Port (Adapted Snippets)

Note: snippets below are **adapted designs** from the upstream SDK source contracts, not copy-paste implementation.

### 9.1 In-process MCP tool registration pattern

Source basis:
1. `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/__init__.py:90`
2. `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:257`

Planned TypeScript form:

```ts
const server = createSdkMcpServer({
  name: "secretary-runtime",
  version: "1.0.0",
  tools: [
    { name: "email.search", description: "...", inputSchema: z.object(...), handler: async (args) => ... },
    { name: "calendar.reschedule", description: "...", inputSchema: z.object(...), handler: async (args) => ... },
  ],
});
```

Repository integration points:
1. Replace custom split/harness glue in `src/server/features/ai/tools/harness/*`.
2. Replace tool registry-to-executor conversion in `src/server/features/ai/tools/harness/tool-definition-adapter.ts:1`.

### 9.2 Session/query options contract

Source basis:
1. `/tmp/claude-agent-sdk-python-1/src/claude_agent_sdk/types.py:716`
2. `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:476`

Planned TypeScript form:

```ts
const options: AgentOptions = {
  model,
  tools,
  allowedTools,
  disallowedTools,
  hooks,
  permissionMode,
  maxTurns,
  maxBudgetUsd,
  mcpServers,
  thinking,
  effort,
};
```

Repository integration points:
1. Collapse custom routing budget knobs in `src/server/features/ai/runtime/router.ts:1`.
2. Move runtime safety budgets from `attempt-loop` to session options.

### 9.3 Streamed query/session controls

Source basis:
1. `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:1028`
2. `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:1166`

Planned TypeScript form:

```ts
const q = query({ prompt, options });
for await (const msg of q) {
  // persist assistant/tool events
}
await q.setPermissionMode("default");
await q.setMcpServers(dynamicServers);
```

Repository integration points:
1. Replace orchestration flow in `src/server/features/ai/runtime/attempt-loop.ts:278`.
2. Normalize message persistence pipeline in `src/server/features/ai/message-processor.ts:918`.

### 9.4 Hook-based policy/telemetry interception

Source basis:
1. `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:269`
2. `/tmp/claude-agent-sdk-ts-pkg/package/sdk.d.ts:1010`

Planned TypeScript form:

```ts
hooks: {
  PreToolUse: [/* policy gate + arg normalization */],
  PostToolUse: [/* telemetry + durability */],
  PostToolUseFailure: [/* retry classification */],
}
```

Repository integration points:
1. Replace ad-hoc lifecycle emission in `src/server/features/ai/runtime/harness/tool-events.ts:1`.
2. Consolidate policy checks now split across runtime/tool layers.

### 9.5 Skills and subagents

Source basis:
1. [platform.claude.com/docs/agent-sdk/skills](https://platform.claude.com/docs/agent-sdk/skills)
2. [platform.claude.com/docs/agent-sdk/subagents](https://platform.claude.com/docs/agent-sdk/subagents)

Planned TypeScript form:

```ts
options.agents = {
  "inbox-specialist": { prompt: "...", tools: ["email.*"] },
  "calendar-specialist": { prompt: "...", tools: ["calendar.*", "task.*"] },
};
```

Repository integration points:
1. Replace heuristic skill scoring in `src/server/features/ai/skills/snapshot.ts:1`.
2. Keep skill content files, change runtime selection semantics.

## 10. Module-by-Module Execution Ownership (Entire `src`)

This table is the execution contract across the entire tree. Detailed per-file line spans remain in the CSV appendix.

| Module | Action | Execution Plan |
|---|---|---|
| `src/app` | `KEEP_UNCHANGED` + `MODIFY_V2_WIRING` | Rewire API handlers to new runtime adapter; keep UI routes and pages stable. |
| `src/components` | `KEEP_UNCHANGED` | No runtime migration changes. |
| `src/enterprise` | `KEEP_UNCHANGED` | No runtime migration changes. |
| `src/env.ts` | `MODIFY_V2_WIRING` | Add feature flags and runtime config for SDK-style sessions, budgets, and rollout controls. |
| `src/lib` | `KEEP_UNCHANGED` | Keep generic utility modules. |
| `src/proxy.ts` | `KEEP_UNCHANGED` | No runtime migration changes. |
| `src/server/auth` | `KEEP_WITH_INTERFACE_CHANGES` | Keep auth logic; update request context contracts passed to runtime. |
| `src/server/db` | `KEEP_WITH_INTERFACE_CHANGES` | Keep schema access; adapt persistence payloads for session/tool events. |
| `src/server/features/ai` | `MODIFY_*` + selective keep/prune | Core runtime replacement and tooling migration; secretary-mode scope enforcement. |
| `src/server/features/approvals` | `KEEP_AUTHORITY_WITH_ADAPTERS` | Keep approval semantics; adapt invocation point to hook-based policy pipeline. |
| `src/server/features/calendar` | `KEEP_AUTHORITY_WITH_ADAPTERS` | Keep calendar domain primitives/providers; adapt interfaces for MCP tool handlers. |
| `src/server/features/channels` | `KEEP_WITH_INTERFACE_CHANGES` | Keep channel integrations; route all execution through one runtime adapter. |
| `src/server/features/conversations` | `KEEP_WITH_INTERFACE_CHANGES` | Keep storage/retrieval; align with session event persistence format. |
| `src/server/features/email` | `KEEP_AUTHORITY_WITH_ADAPTERS` | Keep provider primitives; normalize search/reschedule contracts in tool layer. |
| `src/server/features/integrations` | `KEEP_WITH_RETRY_HARDENING` | Preserve integration stack; tighten retries/timeouts and error typing. |
| `src/server/features/memory` | `KEEP_AND_HARDEN` | Keep context/memory services; simplify runtime hydration path. |
| `src/server/features/notifications` | `KEEP_AND_HARDEN` | Keep notification workflows, especially approval notifications. |
| `src/server/features/policy-plane` | `KEEP_AUTHORITY_WITH_ADAPTERS` | Maintain policy authority; move runtime gate to SDK-style hook lifecycle. |
| `src/server/features/preferences` | `KEEP_AND_HARDEN` | Keep preferences as context/policy inputs. |
| `src/server/features/privacy` | `KEEP_AND_HARDEN` | Keep privacy guardrails in persistence path. |
| `src/server/features/scheduled` | `KEEP_WITH_INTERFACE_CHANGES` | Keep scheduler infra, adapt to new runtime contract. |
| `src/server/features/search` | `PRUNE_FROM_SECRETARY_MODE` | Remove from default secretary runtime path; keep for non-secretary contexts only. |
| `src/server/features/tasks` | `KEEP_AUTHORITY_WITH_ADAPTERS` | Keep task semantics, especially calendar-linked reschedule behavior. |
| `src/server/features/webhooks` | `KEEP_WITH_INTERFACE_CHANGES` | Keep webhooks, adapt payload contracts if runtime event schemas change. |
| `src/server/lib` | `KEEP_WITH_INTERFACE_CHANGES` | Keep infra utilities and LLM wrappers; add Agent-SDK session wrapper layer. |
| `src/server/packages` | `KEEP_UNCHANGED` | No migration changes expected. |
| `src/server/scripts` | `MODIFY_V2_WIRING` | Update validation/eval scripts to new runtime interfaces and telemetry schemas. |
| `src/server/types` | `KEEP_WITH_INTERFACE_CHANGES` | Update shared type contracts for new runtime session/event payloads. |
| `src/server/workers` | `KEEP_WITH_TELEMETRY_UPDATES` | Keep worker logic; update event schema handling and reliability metrics. |
| `src/shaders` | `KEEP_UNCHANGED` | No runtime migration changes. |

## 11. Detailed Workstreams (Entire `src`)

## WS0. Foundation: New Runtime Layer (No behavior switch yet)

Goals:
1. Add `agent-sdk-runtime` module in `src/server/features/ai/runtime`.
2. Implement option builder, session manager, hook registry, MCP server bootstrap.

Files touched:
1. `MODIFY_V2_CORE` files under `src/server/features/ai/runtime/*`.
2. `MODIFY_V2_WIRING` entrypoints that call runtime.

Exit criteria:
1. New runtime can run behind a feature flag without changing user-facing behavior.

## WS1. Replace Orchestration Core

Goals:
1. Remove `turn-compiler` as routing authority.
2. Remove `router` lane strategy as execution authority.
3. Convert `attempt-loop` into SDK session stream processor.

Primary files:
1. `src/server/features/ai/runtime/attempt-loop.ts:278`
2. `src/server/features/ai/runtime/turn-compiler.ts:1`
3. `src/server/features/ai/runtime/router.ts:1`
4. `src/server/features/ai/runtime/turn-contract.ts:124`
5. `src/server/features/ai/runtime/index.ts:11`
6. `src/server/features/ai/message-processor.ts:918`

Prune within this workstream:
1. `src/server/features/ai/runtime/deterministic-cross-surface.ts:1` (remove from secretary runtime mode).

## WS2. Tooling Migration to SDK-Style MCP Contracts

Goals:
1. Convert capability registry definitions to MCP tool declarations.
2. Preserve domain logic (email/calendar/task/policy), remove extra harness glue.

Primary files:
1. `src/server/features/ai/tools/runtime/capabilities/registry.ts:152`
2. `src/server/features/ai/tools/runtime/capabilities/email.ts:168`
3. `src/server/features/ai/tools/runtime/capabilities/calendar.ts:1`
4. `src/server/features/ai/tools/runtime/capabilities/task.ts:1`
5. `src/server/features/ai/tools/providers/email.ts:109`
6. `src/server/features/ai/tools/providers/calendar.ts:24`
7. `src/server/features/ai/tools/harness/tool-definition-adapter.ts:201`
8. `src/server/features/ai/tools/harness/tool-split.ts:3`

Policy/approval continuity:
1. Keep policy plane as hard gate.
2. Move enforcement trigger point to `PreToolUse` hook boundary.

## WS3. Entry Points and API Wiring

Goals:
1. Route all assistant turns through one session runtime adapter.
2. Remove route-level runtime branching.

Primary files:
1. `src/app/api/chat/route.ts:19`
2. `src/app/api/surfaces/inbound/route.ts:1`
3. `src/app/api/surfaces/actions/route.ts:1`
4. `src/server/features/channels/executor.ts:62`

Additional files in scope:
1. All `MODIFY_V2_WIRING` files listed in `docs/plans/appendix/2026-02-23-secretary-v2-heavy-change-files.md`.

## WS4. Reliability Hardening for Inbox and Calendar

Goals:
1. Standardize email retrieval tool contracts for deterministic search behavior.
2. Standardize task/calendar reschedule semantics.

Primary files:
1. `src/server/features/ai/tools/runtime/capabilities/email.ts:192`
2. `src/server/features/ai/tools/runtime/capabilities/validators/email-search.ts:1`
3. `src/server/features/ai/tools/providers/email.ts:39`
4. `src/server/features/ai/tools/runtime/capabilities/task.ts:1`
5. `src/server/features/ai/tools/providers/calendar.ts:116`

Hardening details:
1. Normalize date/time interpretation in one place.
2. Treat task reschedule as first-class calendar mutation path.
3. Ensure tool clarification responses are uniform and machine-actionable.

## WS5. Skills System Migration

Goals:
1. Preserve skill assets.
2. Replace heuristic selection with SDK-style skill/subagent loading strategy.

Primary files:
1. `src/server/features/ai/skills/loader.ts:7`
2. `src/server/features/ai/skills/snapshot.ts:29`
3. `src/server/features/ai/skills/source-loader.ts:49`
4. `src/server/features/ai/skills/catalog/*/SKILL.md`

## WS6. Search Plane Strategy (Secretary Mode)

Goals:
1. Remove dependency on broad unified search for primary inbox retrieval in secretary mode.
2. Keep search infrastructure available outside secretary mode if needed.

Prune/defer files:
1. All `PRUNE_FROM_SECRETARY_MODE` files in appendix list.
2. `web` capability path in secretary mode where not essential.

Rationale:
1. Reduce retrieval mismatch and over-general ranking errors for inbox lookup requests.

## WS7. Non-Secretary Feature Prune/Defer

Goals:
1. Detach non-core features from runtime critical path.

Files:
1. All `PRUNE_OR_DEFER_NON_SECRETARY` files in appendix list.

Notes:
1. This is scope isolation, not permanent deletion by default.
2. These features can remain behind separate workflow entrypoints.

## WS8. Telemetry, Cost, and Control Plane

Goals:
1. Align telemetry with SDK session/tool events.
2. Add budget/turn limits and cost visibility.

Primary files:
1. `src/server/features/ai/runtime/telemetry/schema.ts:108`
2. `src/server/workers/*` (telemetry update bucket)
3. Runtime/session options builder module (new)

Metrics to add:
1. `email_search_success_rate`
2. `task_reschedule_success_rate`
3. `tool_call_failure_rate_by_tool`
4. `approval_roundtrip_latency_ms`
5. `turn_cost_usd`

## WS9. Tests and Quality Gates

Goals:
1. Rebuild tests around session + tool contracts.
2. Add secretary reliability suites.

Test migration scope:
1. All test files in `MODIFY_V2_CORE`, `MODIFY_V2_TOOLING`, `MODIFY_V2_WIRING`.
2. Regression suites for user-critical flows:
   - Find specific email threads reliably.
   - Reschedule existing tasks/events reliably.
   - Approval-required mutations.

Gate criteria before rollout:
1. Inbox find success >= 95% on curated eval set.
2. Task reschedule success >= 95% on curated eval set.
3. No regression in policy approval safety checks.

## 12. Phased Execution Plan

## Phase 1: Runtime skeleton + feature flag

1. Introduce SDK-style runtime modules.
2. Wire `processMessage` to run both old/new in shadow for telemetry only.

## Phase 2: Tool contract migration

1. Move email/calendar/task capabilities behind MCP-style tool wrappers.
2. Keep provider internals intact.

## Phase 3: Switch primary execution path

1. Enable new runtime for internal users.
2. Compare reliability metrics against baseline.

## Phase 4: Prune paths and reduce entropy

1. Disable deterministic cross-surface planner in secretary mode.
2. Disable broad search plane as default secretary retrieval.
3. Isolate non-secretary features.

## Phase 5: Public cutover

1. Gradual percentage rollout.
2. Auto-rollback if SLOs breach.

## 13. Entire `src` Interaction Plan

This section defines exactly how the whole tree is handled.

1. `src/server/features/ai/*`: replace orchestration core and tooling lifecycle, keep domain logic where stable.
2. `src/server/features/search/*`: prune from secretary mode runtime path.
3. `src/server/features/calendar/*` and `src/server/features/email/*`: retain domain primitives/providers, adapt interfaces.
4. `src/server/lib/*`, `src/server/db/*`, `src/server/auth/*`, `src/server/types/*`: keep, adjust runtime interfaces only.
5. `src/app/api/*`: rewire request handlers to single runtime adapter.
6. `src/server/workers/*`: keep, update telemetry schemas/events.
7. `src/components/*`, `src/shaders/*`, most `src/app/*` pages: keep unchanged.

Authoritative per-file/per-line mapping remains in:
1. `docs/plans/appendix/2026-02-23-secretary-v2-src-map.csv`

## 14. Risk Register

1. Risk: Runtime swap introduces hidden regressions in approvals.
   - Mitigation: approval integration tests + staged rollout + policy event auditing.
2. Risk: Email retrieval behavior changes for edge filters.
   - Mitigation: large replay corpus and side-by-side output diffing.
3. Risk: Search-plane prune removes some previously available capabilities.
   - Mitigation: explicit secretary-mode contract and fallback path outside secretary mode.
4. Risk: Tool explosion in MCP layer degrades model selection quality.
   - Mitigation: intent-based tool subsets + allow/disallow policy layering.

## 15. Deliverables

1. New runtime architecture docs and decision log.
2. Full migration PR sequence by workstream.
3. Updated eval suites and reliability dashboards.
4. Cutover playbook + rollback runbook.

## 16. Immediate Next Implementation Ticket Breakdown

1. `RUNTIME-001`: Introduce SDK-style runtime session module and feature flag.
2. `RUNTIME-002`: Port tool harness to MCP server registration.
3. `RUNTIME-003`: Replace `attempt-loop` with session stream executor.
4. `RUNTIME-004`: Migrate message processor and channel entrypoints.
5. `TOOLS-001`: Email/search contract hardening.
6. `TOOLS-002`: Task/calendar reschedule contract hardening.
7. `SCOPE-001`: Secretary-mode prune gates for search and non-secretary features.
8. `OBS-001`: Telemetry/cost schema migration.
9. `EVAL-001`: Reliability benchmark suite and rollout guardrails.

## 17. Notes on Implementation Style

1. This is a planning document only; no runtime code changes are included here.
2. TypeScript runtime implementation should follow Agent SDK concepts exactly, but with repository-specific domain adapters.
3. Every `src` file action is already assigned and must be respected during implementation execution.
