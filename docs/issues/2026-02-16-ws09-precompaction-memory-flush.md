# Issue: WS-09 Pre-Compaction Memory Flush

## Problem
Durable memory may be lost before compaction.

## Approach
Run a silent memory flush turn near compaction threshold.

## Atomic Tasks
1. Add flush thresholds and prompts.
2. Add NO_REPLY safeguards.
3. Add once-per-compaction-cycle semantics.
4. Add metadata tracking.

## References
- https://docs.openclaw.ai/reference/session-management-compaction
- OpenClaw refs:
  - `/Users/dannywang/Projects/openclaw/src/auto-reply/reply/memory-flush.ts`
  - `/Users/dannywang/Projects/openclaw/src/auto-reply/reply/agent-runner-memory.ts`

## DoD
- Memory flush executes silently and safely under threshold conditions.
