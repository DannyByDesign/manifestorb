# Issue: WS-07 Context Pruning

## Problem
Tool output bloat causes context pressure and quality/cost degradation.

## Approach
Add pre-send soft/hard pruning with safety invariants.

## Atomic Tasks
1. Add pruning config and defaults.
2. Implement soft-trim + hard-clear behavior.
3. Protect recent assistant tail and all user messages.
4. Add telemetry and tests.

## References
- https://docs.openclaw.ai/concepts/session-pruning
- OpenClaw ref: `/Users/dannywang/Projects/openclaw/src/agents/pi-extensions/context-pruning/pruner.ts`

## DoD
- Context remains bounded in long tool-heavy sessions.
