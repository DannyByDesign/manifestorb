# AI Runtime (Runtime-First)

This folder contains the assistant runtime used by inbox/calendar surfaces.

## Execution Flow

1. `message-processor.ts` receives the user turn.
2. `runtime/session.ts` builds runtime context:
   - semantic turn contract (embedding-first with lexical fallback)
   - tool capabilities
   - skill prompt snapshot
   - semantic candidate tool narrowing
   - OpenClaw-style layered deterministic filtering:
     - profile
     - provider-profile
     - global allow/deny
     - global provider allow/deny
     - agent allow/deny
     - agent provider allow/deny
     - group policy
     - sandbox policy
     - subagent policy
   - ranked runtime tool registry
3. `runtime/router.ts` selects a routing lane and per-lane budgets:
   - `direct_response` (no tools)
   - `macro_tool` (deterministic one-tool execution)
   - `planner_fast` (tight SLA, reduced planner context)
   - `planner_standard`
   - `planner_deep` (complex/cross-domain)
4. `runtime/attempt-loop.ts` runs bounded model/tool iterations using lane budgets.
5. Tool calls execute through:
   - `tools/harness/tool-definition-adapter.ts`
   - `tools/harness/tool-split.ts`
   - `runtime/harness/session-runner.ts`
   - `runtime/harness/tool-events.ts`
   - `tools/runtime/capabilities/executors/*`
6. Policy and approval checks run before mutating tool calls.

## Important Directories

```
ai/
├── runtime/                        # Turn loop, session/context setup, response contract
├── skills/                         # Prompt-layer skills catalog and composition
├── tools/
│   ├── runtime/capabilities/       # Canonical runtime tool metadata + execution
│   ├── providers/                  # Email/calendar provider adapters
│   ├── packs/                      # Tool pack manifests and loader
│   ├── fabric/                     # Tool assembly + policy filter integration
│   ├── harness/                    # OpenClaw-style tool definition/split harness
│   ├── calendar/                   # Calendar tool primitives
│   └── email/                      # Email tool primitives
├── runtime/harness/                # Session runner + tool lifecycle emitters
├── policy/                         # Runtime policy hooks
└── message-processor.ts            # Unified runtime entrypoint
```

## Guardrails

- Mutating tools are policy-gated (`ai/policy/enforcement.ts`).
- Approvals are persisted and replayed via `features/approvals`.
- Runtime tool metadata is source-of-truth in `tools/runtime/capabilities/registry.ts`.
