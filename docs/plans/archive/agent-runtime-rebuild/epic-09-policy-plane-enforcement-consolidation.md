# Epic 09: Policy Plane Enforcement Consolidation

Status: Planned
Priority: P1
Depends on: Epics 04, 07

## Objective

Guarantee identical guardrail behavior across direct skills and planner execution through a single policy enforcement contract.

## Problem statement

Policy checks are present in multiple paths; divergence risk remains for transformed args, approval requirements, and mutation semantics.

## In scope

- Normalize policy enforcement call contract.
- Align transformed-args behavior between skill and planner flows.
- Standardize policy decision logging fields.

## Out of scope

- Rule authoring UX redesign.
- New policy engine implementation.

## Affected code

- `src/server/features/policy-plane/pdp.ts`
- `src/server/features/ai/skills/executor/execute-skill.ts`
- `src/server/features/ai/planner/execute-plan.ts`
- `src/server/features/ai/planner/policy-context.ts`

## Implementation plan

### Step 1: Define unified policy input schema

Required fields:
- actor/user context
- resource
- operation
- item count
- args
- source route type

### Step 2: Unify decision handling

For both planner and skill paths:
- allow
- allow with transform
- require approval
- block

### Step 3: Unify mutation logging

Ensure policy execution logs include same dimensions regardless of route path.

### Step 4: Verify read-only bypass behavior

Ensure read-only capabilities are consistently bypassing approval while still logging decisions as needed.

## Manual validation checklist

1. Execute same mutation via skill and planner.
2. Confirm identical policy decision behavior.
3. Confirm approval payload consistency.

## Acceptance criteria

1. No route-dependent policy behavior mismatch for same operation.
2. Transformed args behavior matches in both executors.
3. Policy telemetry fields are uniform.

## Risks and mitigations

- Risk: stricter policy normalization blocks previously allowed edge actions.
- Mitigation: rollout with policy decision diff logging before strict enforcement.

## Rollback plan

- Revert deployment/commit if policy parity changes block legitimate operations unexpectedly.
