# Issue: WS-01 Runtime Context Pack Wiring

## Problem
Main runtime turns do not consume `ContextManager.buildContextPack()`.

## Approach
Inject context pack into runtime hydration/session/prompt build path with graceful fallback.

## Atomic Tasks
1. Add `contextPack` to runtime hydrated context and runtime session types.
2. Build context pack in `hydrateRuntimeContext`.
3. Inject bounded context summary into native runtime prompt and response writer.
4. Add telemetry for context pack composition and fallback reasons.
5. Add tests for normal and degraded paths.

## Code Touchpoints
- `src/server/features/ai/runtime/context/hydrator.ts`
- `src/server/features/ai/runtime/types.ts`
- `src/server/features/ai/runtime/index.ts`
- `src/server/features/ai/runtime/attempt-loop.ts`
- `src/server/features/ai/runtime/response-writer.ts`

## References
- https://docs.langchain.com/oss/javascript/langgraph/add-memory
- https://docs.langchain.com/oss/javascript/langgraph/memory
- OpenClaw ref: `/Users/dannywang/Projects/openclaw/src/agents/system-prompt.ts`

## DoD
- Runtime includes structured memory context for every turn.
- Degraded behavior remains functional when context build fails.
