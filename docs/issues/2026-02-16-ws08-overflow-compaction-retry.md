# Issue: WS-08 Overflow Compaction + Retry

## Problem
Context overflow should recover automatically.

## Approach
Detect overflow, compact, retry once, then fail gracefully.

## Atomic Tasks
1. Normalize overflow error detection.
2. Add compaction trigger and retry loop.
3. Add failure-path user messaging + telemetry.
4. Add tests for success/failure branches.

## References
- https://arxiv.org/abs/2310.08560
- OpenClaw ref: `/Users/dannywang/Projects/openclaw/src/agents/pi-embedded-runner/run.ts`

## DoD
- One automatic compaction retry attempted on overflow.
