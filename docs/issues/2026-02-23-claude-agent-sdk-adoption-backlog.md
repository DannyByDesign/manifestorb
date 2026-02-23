# Issue: Claude Agent SDK Pattern Adoption Backlog

## Problem

`amodel` has a strong runtime foundation, but reliability can improve further by adopting selected Claude Agent SDK patterns (without replacing domain-specific inbox/calendar execution core).

## Scope

Implement prioritized architecture upgrades in TypeScript runtime:

1. Progressive skill disclosure (index first, load one skill on demand).
2. Tool metadata enhancements (`input_examples`, hint annotations).
3. Deferred tool loading + tool-search primitive.
4. Hook/event lifecycle around tool execution (pre/post/failure/permission-like hooks).
5. Session control parity (resume/fork/interruption contracts).
6. Reliability evals for high-risk mutation paths.

## Proposed Work Items

1. `feat(ai/skills): progressive-disclosure prompt and single-skill load path`
2. `feat(ai/tools): registry support for input examples and annotations`
3. `feat(ai/tools): deferred loading and tool-search capability`
4. `feat(ai/runtime): deterministic tool lifecycle hook bus`
5. `feat(ai/runtime): session fork/resume surface contract`
6. `eval(ai): mutation-accuracy + clarification-loop benchmark suite`

## Touchpoints

- `src/server/features/ai/skills/*`
- `src/server/features/ai/runtime/attempt-loop.ts`
- `src/server/features/ai/runtime/session.ts`
- `src/server/features/ai/tools/runtime/capabilities/registry.ts`
- `src/server/features/ai/tools/harness/tool-definition-adapter.ts`
- `src/server/features/ai/runtime/types.ts`
- `tests/evals/*`

## Definition of Done

- Progressive disclosure replaces current top-4 full skill body injection path.
- Complex tool argument reliability improves measurably on new eval set.
- Runtime emits deterministic hook events around tool calls.
- Tool catalog token pressure reduced via deferred loading/tool search.
- Session fork/resume semantics documented and test-covered.
- No regression in approval/policy enforcement behavior.
