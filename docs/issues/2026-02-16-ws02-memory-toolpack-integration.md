# Issue: WS-02 Memory Toolpack Integration

## Problem
Memory tools exist but are not available in active runtime tool packs.

## Approach
Add `memory.*` tool capabilities + executors + pack registration + policy coverage.

## Atomic Tasks
1. Add memory capability definitions to runtime registry.
2. Add memory capability module and executors.
3. Add `memory` tool pack manifest and registry entry.
4. Ensure policy layering controls memory tools.
5. Add tests for registration, execution, policy filtering.

## Code Touchpoints
- `src/server/features/ai/tools/runtime/capabilities/registry.ts`
- `src/server/features/ai/tools/runtime/capabilities/index.ts`
- `src/server/features/ai/tools/runtime/capabilities/executors/index.ts`
- `src/server/features/ai/tools/packs/registry.ts`
- `src/server/features/ai/tools/packs/loader.ts`

## References
- https://docs.letta.com/guides/core-concepts/memory/memory-blocks
- https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/memory/
- OpenClaw refs:
  - `/Users/dannywang/Projects/openclaw/extensions/memory-core/index.ts`
  - `/Users/dannywang/Projects/openclaw/src/agents/tools/memory-tool.ts`

## DoD
- `memory.*` tools available at runtime when policy allows.
