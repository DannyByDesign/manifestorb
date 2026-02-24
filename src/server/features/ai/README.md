# AI Runtime (`src/server/features/ai`)

This directory contains the unified assistant runtime used by:
- the web chat (`src/app/api/chat/route.ts`)
- surfaces (Slack/Discord/Telegram) via `src/app/api/surfaces/inbound/route.ts`

The runtime is "open-world": the model produces tool calls, those tool calls are executed via a capability layer, and the runtime iterates for a bounded number of steps before finalizing a response.

## Entry Points

- Message processor: `message-processor.ts`
  - normalizes inbound messages (web vs surfaces)
  - handles pending decisions (approve/deny, schedule proposals, ambiguous time choices) deterministically when possible
  - calls the runtime kernel to produce a response + tool execution summary

- Runtime kernel: `runtime/index.ts`
  - `runOpenWorldRuntimeTurn(...)` is the main orchestration entrypoint
  - hydrates the runtime ContextPack for execution
  - builds a deterministic turn contract for session/tool policy
  - runs a single session execution loop with bounded steps and tool policies

## Runtime Layout

Key subdirectories/files:
- `system-prompt.ts`: minimal global policy/style shell (identity, safety, formatting)
- `runtime/`: budgets, session attempt loop, response contract, and MCP-style tool assembly
- `tools/`: tool registry + executors
  - `tools/runtime/capabilities/registry.ts`: canonical tool metadata (source of truth)
  - `tools/runtime/capabilities/executors/*`: actual implementations (email/calendar/memory/search/etc.)
- `security.ts`: prompt-injection protection and other safety hardening

## Turn Contract (Deterministic)

The runtime converts each user turn into a deterministic `RuntimeTurnContract` which drives:
- whether tools are allowed (`toolChoice`)
- whether the turn is conversation-only vs tool-eligible (`routeHint`)
- whether the turn should prefer internal knowledge vs web (`knowledgeSource`)
- whether freshness matters (`freshness`)

Relevant files:
- contract: `src/server/features/ai/runtime/turn-contract.ts`

## Routing Lanes

Execution is determined by the turn contract:
- `conversation_only`: native generation with tools disabled.
- `planner`: normal tool loop with a pruned tool catalog and bounded steps.

Routing is handled directly in `src/server/features/ai/runtime/attempt-loop.ts`.

## Tool Admission (Pruning + Policy Layers)

Tool catalogs are always pruned before being shown to the model. This is not meant to "limit autonomy"; it is a latency and quality control step so the model sees the smallest, safest set of relevant tools for the turn.

The admission pipeline:
1. Candidate selection by turn contract (domain/operation, read-only) and knowledge source (`internal` vs `web`): `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
2. Deterministic allow/deny policy layers (user, provider, agent, group, sandbox/subagent): `src/server/features/ai/tools/fabric/policy-filter.ts`
3. Ranking + limiting:
   - semantic ranking uses OpenAI embeddings when available (disabled in tests)
   - deterministic lexical scoring is the fallback
   - both approaches also consider tool intent families/tags and read-only vs mutation needs

Session wiring and telemetry: `src/server/features/ai/runtime/session.ts`.

## Web Search Tools

Web tools are implemented under `src/server/features/ai/tools/runtime/capabilities/web.ts` and registered in `src/server/features/ai/tools/runtime/capabilities/registry.ts`.

Explicit user requests to search the web are admitted through the session tool catalog and handled by the same session loop.

## Safety Model

- The runtime never claims side effects succeeded unless execution confirms it.
- Mutations are gated by policy and approvals:
  - approvals live in `src/server/features/approvals/*`
  - tool enforcement hooks live under `policy/` and runtime tool layers

When changing tools:
1. Update tool metadata (registry).
2. Update the executor implementation.
3. Add/update tests that validate policy/approval behavior.
