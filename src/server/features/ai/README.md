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

## Runtime Layout

Key subdirectories/files:
- `system-prompt.ts`: minimal global policy/style shell (identity, safety, formatting)
- `runtime/`: budgets, attempt loop, response contract, and tool-runtime glue
- `tools/`: tool registry + executors
  - `tools/runtime/capabilities/registry.ts`: canonical tool metadata (source of truth)
  - `tools/runtime/capabilities/executors/*`: actual implementations (email/calendar/memory/search/etc.)
- `security.ts`: prompt-injection protection and other safety hardening

## Safety Model

- The runtime never claims side effects succeeded unless execution confirms it.
- Mutations are gated by policy and approvals:
  - approvals live in `src/server/features/approvals/*`
  - tool enforcement hooks live under `policy/` and runtime tool layers

When changing tools:
1. Update tool metadata (registry).
2. Update the executor implementation.
3. Add/update tests that validate policy/approval behavior.

