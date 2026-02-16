# Issue: WS-13 Eval Harness and Gates

## Problem
No hard evidence that memory/context changes improve outcomes without regressions.

## Approach
Build eval datasets + automated scoring + rollout gates.

## Atomic Tasks
1. Add memory recall eval corpus.
2. Add metrics: precision/recall, groundedness, contradiction, latency, action safety.
3. Add gate thresholds and canary dashboard hooks.

## References
- https://arxiv.org/abs/2404.16130
- https://arxiv.org/abs/2405.14831

## DoD
- Release gates enforced before full rollout.
