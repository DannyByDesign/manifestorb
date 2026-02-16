# Issue: WS-12 Context Slot Budgeting

## Problem
Without deterministic slot budgeting, context quality is unpredictable under load.

## Approach
Define per-lane token budgets and slot priority/degradation policy.

## Atomic Tasks
1. Add lane budget config and slot priorities.
2. Add slot truncation/degradation logic.
3. Add slot-level telemetry.

## References
- https://docs.langchain.com/oss/javascript/langgraph/memory
- https://arxiv.org/abs/2310.08560

## DoD
- Slot budgets enforced and observable in runtime metrics.
