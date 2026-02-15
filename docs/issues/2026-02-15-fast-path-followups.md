# Issue: Fast-Path Follow-ups (SLA + Rule Target Resolver)

## Context

The core fast-path coverage refactor is implemented, including semantic-first admission,
operation-catalog matching, completeness guards, and planner fallback.

Two follow-ups remain to fully close production readiness:

1. SLA telemetry validation
2. Plain-English rule target resolution for disable/delete/update

## Scope

1. Add and review production dashboards for fast-path:
- p50/p95/p99 latency by operation (`reason`)
- fallback causes (`incomplete`, `timeout`, `tool_error`)
- provider split (Google vs Microsoft)

2. Implement safe plain-English rule mutation targeting:
- resolve candidate rule from natural language description
- confidence+margin threshold for auto-selection
- planner clarification fallback when ambiguous

## Required Outcomes

- Fast-path SLA compliance can be measured continuously from telemetry.
- Users can disable/delete/update rules by plain English without knowing IDs.
- No unsafe/incorrect rule targeting under ambiguity.
