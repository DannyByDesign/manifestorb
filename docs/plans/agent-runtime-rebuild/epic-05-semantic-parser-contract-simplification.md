# Epic 05: Semantic Parser Contract Simplification

Status: Planned
Priority: P0
Depends on: Epic 01

## Objective

Refactor semantic parser output contract to provider-safe schema and reduce parser failure churn.

## Problem statement

Parser currently uses broad value unions with object records that can compile into provider-incompatible schema and trigger non-deterministic degraded behavior.

## In scope

- Simplify parser output schema.
- Replace broad value unions with typed entity variants.
- Keep a deterministic parser degraded-mode path within the same architecture (no legacy runtime path).

## Out of scope

- Full NLU model replacement.
- Planner scoring redesign.

## Affected code

- `src/server/features/ai/skills/router/parse-request.ts`
- `src/server/features/ai/skills/contracts/semantic-request.ts`
- `src/server/features/ai/skills/router/route-intent-family.ts`

## Implementation plan

### Step 1: Introduce compact parser DTO

Structure:
- `intents[]`
- `tasks[]` with typed `entities[]`
- `unresolved[]`
- `confidence`

Entity types should be bounded and explicit.

### Step 2: Add DTO-to-internal mapper

Map parser DTO into richer internal semantic request model.
Reject unknown entity types and log structured reason.

### Step 3: Improve degraded-mode confidence handling

When parser fails:
- use deterministic intent extraction
- set transparent reduced confidence
- preserve unresolved reasons

### Step 4: Align downstream consumers

Update router/planner capability selector to consume simplified contract directly.

## Manual validation checklist

1. Send varied inbox/calendar prompts.
2. Verify parser route no longer throws provider schema errors.
3. Verify degraded-mode parser path produces stable, bounded outputs.

## Acceptance criteria

1. Parser schema is provider-safe and versioned.
2. Parser failure rate due to schema mismatch drops to zero.
3. Downstream routing behavior remains deterministic.

## Risks and mitigations

- Risk: reduced parser richness hurts edge intent recognition.
- Mitigation: preserve optional internal enrichment step after safe parse.

## Rollback plan

- Revert deployment/commit if parser DTO migration introduces critical routing regressions.
