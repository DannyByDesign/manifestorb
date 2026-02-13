# Epic 04: Planner Typed-Args Refactor

Status: Planned
Priority: P0
Depends on: Epic 01

## Objective

Replace open planner `args` objects with capability-typed argument schemas to prevent plan build schema failures and unsafe runtime argument drift.

## Problem statement

Planner currently allows open `args` shape, causing provider schema failures and runtime fragility.

## In scope

- Introduce capability-to-args schema registry.
- Replace planner step schema with typed discriminated union.
- Normalize and validate plan before execution.

## Out of scope

- Large planner strategy redesign.
- New capabilities beyond schema hardening.

## Affected code

- `src/server/features/ai/planner/plan-schema.ts`
- `src/server/features/ai/planner/build-plan.ts`
- `src/server/features/ai/planner/validate-plan.ts`
- `src/server/features/ai/planner/invoke-capability.ts`
- `src/server/features/ai/capabilities/registry.ts`

## Implementation plan

### Step 1: Define `CapabilityArgsSchemaMap`

For each planner-eligible capability:
- explicit arg schema
- required fields
- optional fields
- defaults where safe

### Step 2: Refactor planner step schema

Use discriminated union:
- discriminator: capability id
- branch: typed `args` schema for that capability

### Step 3: Update plan builder prompt contract

Prompt must explicitly require:
- capability from candidate list
- args conforming to listed capability schema

### Step 4: Strengthen validation phase

Validation must reject:
- unknown capability
- args mismatch
- unresolved template references
- cyclic dependencies

### Step 5: Safe normalization

Before execution:
- apply defaults
- normalize primitive coercions only when lossless
- reject coercions that change semantics

## Manual validation checklist

1. Trigger planner on long-tail supported request.
2. Confirm plan builds with typed args.
3. Confirm invalid args are rejected with clarification prompt.
4. Confirm no provider schema errors from planner route.

## Acceptance criteria

1. Planner no longer uses open-ended `args` objects.
2. Plan build failures from empty object schema are eliminated.
3. Execution only runs validated typed args.

## Risks and mitigations

- Risk: capability map incompleteness blocks valid plans.
- Mitigation: startup invariant that every planner-exposed capability has registered args schema.

## Rollback plan

- Revert deployment/commit if typed planner args path causes critical plan build regressions.
