# Claude Agent SDK Architecture Review (for `amodel`)

Date: 2026-02-23
Scope: Claude Agent SDK architecture/capabilities, OpenClaw-style architecture patterns, and fit for this TypeScript inbox/calendar assistant.

## Executive Summary

- Your current runtime is already strong on policy gating, approval enforcement, tool pruning, and context hygiene.
- The highest-value ideas to adopt from Claude Agent SDK are not "replace everything with Claude Code tools", but:
  - progressive skill disclosure,
  - richer tool metadata (`input_examples`, annotations, deferred loading),
  - hookable lifecycle controls around tool execution,
  - explicit session controls (resume/fork/interruption semantics),
  - and better cost/latency guardrails.
- Full migration to Claude Agent SDK as the core execution engine is high-risk for product fit, because its built-in tooling is code-workflow-centric (Bash/files/web) while your product's core is inbox/calendar mutation correctness and approvals.
- Recommended strategy: keep your runtime kernel and policy plane, import selected Claude Agent SDK patterns into your TypeScript stack in phases.

## What You Have Today (Repo Findings)

Relevant paths:
- `src/server/features/ai/runtime/index.ts`
- `src/server/features/ai/runtime/attempt-loop.ts`
- `src/server/features/ai/runtime/session.ts`
- `src/server/features/ai/runtime/turn-compiler.ts`
- `src/server/features/ai/tools/runtime/capabilities/registry.ts`
- `src/server/features/ai/tools/harness/tool-definition-adapter.ts`
- `src/server/features/ai/policy/enforcement.ts`
- `src/server/features/ai/skills/snapshot.ts`

Current architecture highlights:
- Open-world runtime with bounded attempt loop and lane routing (`conversation_only`, `single_tool`, `planner`).
- Compiler-driven turn contract with tool-choice and knowledge-source controls.
- Deterministic + semantic tool admission pipeline with layered policy filtering.
- Strong mutation control via policy plane and explicit approval creation.
- Clarification-first behavior for incomplete args.
- Runtime telemetry for route/tool/context lifecycle.

Tool surface snapshot:
- 73 registered runtime tools.
- Distribution: `email` 35, `calendar` 18, `task` 3, `memory` 4, `search` 1, `web` 2, `planner` 2, `policy` 8.
- Risk labels: `safe` 37, `caution` 21, `dangerous` 15.

Skill system snapshot:
- Skills are loaded from bundled/managed/workspace sources, with precedence.
- Selection is simple lexical scoring, then top 4 are injected into prompt.
- This is useful, but not true progressive disclosure (full skill bodies are pre-injected per turn).

## Claude Agent SDK: Architecture and Capability Notes

Primary sources:
- [Agent SDK overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK reference](https://platform.claude.com/docs/en/agent-sdk/typescript/reference)
- [Python SDK reference](https://platform.claude.com/docs/en/agent-sdk/python)
- [Sessions guide](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [Permissions guide](https://platform.claude.com/docs/en/agent-sdk/permissions)
- [Approvals + user input guide](https://platform.claude.com/docs/en/agent-sdk/user-input)
- [Subagents guide](https://platform.claude.com/docs/en/agent-sdk/subagents)
- [MCP guide](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Custom tools guide](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [Skills guide](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Track costs guide](https://platform.claude.com/docs/en/agent-sdk/track-costs)
- [Secure deployment guide](https://platform.claude.com/docs/en/agent-sdk/secure-deployment)
- [Claude Code settings (tools available)](https://docs.anthropic.com/en/docs/claude-code/settings#tools-available-to-claude)

Core SDK ideas that matter for you:
- Session-native control model (resume/fork, streaming, interruption, control requests).
- Permission modes and runtime approval hooks (`allow/deny/ask` plus permission suggestions).
- Hook system around execution lifecycle (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `PermissionRequest`, etc.).
- Built-in robust tooling + tool schemas (Bash/file/web + others), and MCP-first custom tool extension.
- Agent Skills model with discoverability and on-demand loading.
- Subagent/task delegation with scoped tools/prompts.

Important practical caveat:
- Built-in tools are excellent for coding/runtime tasks, but do not provide your inbox/calendar business semantics out of the box.
- You still need domain tools and policy logic for calendar/email integrity, approvals, and user trust.

## Advanced Tool-Use Patterns (Anthropic 2025 Release)

Primary source:
- [Anthropic: New advanced tool use for API](https://www.anthropic.com/engineering/advanced-tool-use-for-claude)
- [Programmatic tool use docs](https://platform.claude.com/docs/agents-and-tools/tool-use/implement-tool-use)
- [Tool helpers (Tool Use Examples)](https://platform.claude.com/docs/agents-and-tools/tool-use/tool-helpers)

Patterns worth porting:
- Programmatic tool use (code-execution-mediated chaining) to reduce token-heavy tool ping-pong.
- Dynamic filtering for web fetch (trim noise before injecting content).
- Tool search + deferred loading (avoid exposing huge tool catalogs every turn).
- Tool use examples (`input_examples`) to improve argument correctness on complex tools.

For `amodel`, these map directly to known reliability pain points:
- Long multi-step inbox/calendar workflows with lots of intermediate payload.
- Tool argument ambiguity and repeated clarification loops.
- Large tool catalog pressure (73 tools).

## OpenClaw Pattern Cross-Check

Relevant local reference:
- `/Users/dannywang/Projects/openclaw/src/agents/system-prompt.ts`
- `/Users/dannywang/Projects/openclaw/docs/tools/skills.md`

Patterns in OpenClaw that are useful for your product:
- Skill progressive disclosure by listing skills first, then reading a single selected `SKILL.md` only when needed.
- Strong skill source precedence and skill gating metadata.
- Session hygiene model (pruning/compaction docs) with explicit operational controls.

Compared to that, your current skill prompt path is simpler and more static; this is a good improvement opportunity.

## YouTube Transcript Findings (Requested Videos)

Videos:
- [Video 1](https://www.youtube.com/watch?v=_h2EnRfxMQE)
- [Video 2](https://www.youtube.com/watch?v=3wglqgskzjQ)

Transcript extraction status:
- Successfully extracted with `youtube-transcript-api` (auto captions).

Saved local transcripts:
- `/tmp/yt-transcripts/_h2EnRfxMQE.txt`
- `/tmp/yt-transcripts/3wglqgskzjQ.txt`

Useful points (validated against docs where possible):
- Good framing: agent = model + tools + loop.
- Emphasis on SDK-provided reliability primitives (sessions, tools, orchestration).
- Correctly highlights skills/progressive disclosure pattern importance.
- Correctly highlights advanced tool-use improvements (programmatic tool use, tool search, input examples, dynamic filtering), which are now in Anthropic docs.

## Recommended Direction for `amodel`

### Recommendation

Do **not** replace your runtime kernel with Claude Agent SDK wholesale right now.

Instead: run a **pattern adoption program** that preserves your domain core and reliability controls.

### Why

- Your critical value is inbox/calendar correctness + approvals, not generic code-agent behavior.
- Your existing policy plane, tool registry, and execution wrappers are already aligned to this domain.
- Full migration would introduce a large risk surface (control-flow differences, permission semantics, multi-tenant deployment concerns) without guaranteed reliability gain on calendar/email actions.

## Concrete Refactor Plan (TypeScript, staged)

### Phase 1 (High ROI, low risk)

1. Progressive skill disclosure:
   - Change skills prompt injection from "top 4 full bodies" to:
     - skill index (name + short description + location),
     - runtime instruction to load exactly one skill body when selected.
2. Tool metadata expansion:
   - Add `input_examples` equivalent to tool registry entries for complex tools.
   - Add annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) in registry metadata.
3. Improve tool admission:
   - Add deferred-loading concept + "tool search" capability for long-tail tools.
4. Hook-like lifecycle layer:
   - Introduce deterministic pre/post/failure tool callbacks around `execute` in `tool-definition-adapter.ts`.

### Phase 2 (Medium risk, high leverage)

1. Programmatic tool chaining lane:
   - Add a constrained code-execution planner mode for deterministic dataflow-heavy workflows.
   - Start with read-only chains (search/list/aggregate) before mutation flows.
2. Rich permission/approval UX:
   - Add "permission suggestion" objects to approval responses to support one-tap persistent rule updates.
3. Session control parity:
   - Formalize resume/fork/interruption APIs for channels/web parity.

### Phase 3 (Validation + optional integration)

1. Hybrid "Claude Agent SDK sidecar" experiment:
   - Stand up a TS adapter service that can run Claude Agent SDK in isolated paths for targeted workflows (e.g., deep research/web synthesis).
   - Keep inbox/calendar mutations routed through existing runtime + policy plane.
2. Decision gate:
   - Compare reliability/latency/cost against baseline eval harness.
   - Expand only if measurable wins hold.

## Reliability Guardrails to Add Immediately

1. Add argument-accuracy eval set focused on high-risk calendar/email mutations.
2. Add per-tool schema success metrics and clarification-loop counters.
3. Add cost budget + turn budget fail-fast policies per lane.
4. Add replayable "tool trace" persistence for failed/blocked turns.

## Specific Gaps vs Claude Agent SDK to Track

- Missing first-class hook/event API for deterministic intervention.
- Skills are not truly on-demand loaded.
- No tool `input_examples` support in registry schema.
- No deferred tool schema loading / tool-search primitive.
- No explicit session fork semantics in public runtime API.

## Suggested Near-Term Backlog Items

1. `feat(ai/skills): progressive-disclosure prompt path with one-skill load policy`
2. `feat(ai/tools): add tool input examples + annotations to registry schema`
3. `feat(ai/runtime): lifecycle hook bus for pre/post/failure tool execution`
4. `feat(ai/tools): deferred-loading + tool-search capability`
5. `feat(ai/runtime): session fork/resume control contract`
6. `eval(ai): mutation-accuracy and clarification-loop benchmark suite`

## Notes on Language/Stack Fit (Python SDK vs TypeScript Repo)

- You can use Anthropic's TypeScript package directly (`@anthropic-ai/claude-agent-sdk`), so Python is not a hard blocker.
- Python examples are currently richer in narrative docs and sample depth, but the TS package has full type surface for sessions, hooks, permissions, MCP, subagents, and plugins.
- If you do cross-language experimentation, isolate it behind a strict transport boundary (e.g., dedicated sidecar service) and keep domain mutation enforcement in your TypeScript policy plane.

## Bottom Line

You already have most of the hard domain-specific reliability architecture. The best move is to absorb Claude Agent SDK execution patterns (especially skills/tool ergonomics and lifecycle controls) into your TypeScript runtime, rather than replacing your inbox/calendar core with a code-agent-first runtime.
