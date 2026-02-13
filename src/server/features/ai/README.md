# AI Runtime (Skills-First)

This module now runs a **skills-only** assistant architecture for inbox and calendar operations.

## Source of Truth Plan

The migration and runtime boundary reference is:

`docs/plans/AI_SKILLS_REFACTOR_SOURCE_OF_TRUTH.md`

## Runtime Boundary

1. `message-processor` runs conversational preflight.
2. If the turn is conversational, it answers directly (no tool execution).
3. If the turn is operational, it runs the skills runtime:
   - router
   - slot resolver
   - deterministic executor
   - postcondition validator
4. All operational mutations flow through skill contracts and capability facades.

There is no legacy LLM polymorphic tool-calling loop in the production assistant path.

## Key Directories

```
ai/
├── capabilities/      # Narrow typed capability facades (email/calendar/planner)
├── skills/
│   ├── baseline/      # Baseline universal inbox/calendar skills
│   ├── contracts/     # Skill schema + slot schema
│   ├── executor/      # Deterministic execution + postconditions
│   ├── registry/      # Baseline registry
│   ├── router/        # Closed-set skill routing
│   ├── slots/         # Slot extraction + clarification
│   └── telemetry/     # Runtime telemetry events
├── orchestration/
│   └── preflight.ts   # Conversational preflight gate
├── message-processor.ts
├── system-prompt.ts   # Minimal global policy/style shell
└── tools/
    ├── providers/     # Provider adapters used by capabilities
    ├── calendar-time.ts
    ├── timezone.ts
    └── types.ts
```

## Notes

- Rule automation execution remains in rule-engine modules; that is separate from assistant turn execution.
- Approval flows for schedule proposals and ambiguous time now execute through structured deterministic handlers, not polymorphic tool maps.
