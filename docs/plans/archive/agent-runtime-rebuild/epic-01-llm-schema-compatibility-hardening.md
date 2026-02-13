# Epic 01: LLM Schema Compatibility Hardening

Status: Planned
Priority: P0
Depends on: none

## Objective

Eliminate structured-output schema rejections across all runtime lanes that call `generateObject`.

## Problem statement

Current logs show provider schema failures in preflight, semantic parser, and planner. This causes incorrect routing and high latency.

## In scope

- Refactor provider-facing schemas to comply with `schema-safety-spec.md`.
- Introduce schema registry and startup validation.
- Version and name each provider-facing schema.

## Out of scope

- Routing behavior changes (handled by later epics).
- Planner UX output changes.

## Affected code

- `src/server/features/ai/orchestration/preflight.ts`
- `src/server/features/ai/skills/router/parse-request.ts`
- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/slots/resolve-slots.ts`
- `src/server/features/ai/planner/plan-schema.ts`
- `src/server/features/ai/planner/build-plan.ts`
- `src/server/lib/llms/index.ts`

## Implementation plan

### Step 1: Inventory and classify all provider-facing schemas

Create a registry document and code registry listing:
- feature label
- schema owner
- current risks
- migration target type

### Step 2: Remove forbidden patterns

- Replace transformed numeric fields with plain provider-safe types.
- Replace `unknown` object records in provider schemas with typed shapes.
- Replace broad object unions with discriminated unions.

### Step 3: Introduce provider-safe DTO schemas

For each lane:
- define `ProviderSchemaV1`
- define internal rich schema
- convert provider DTO -> internal object in dedicated mapper

### Step 4: Add startup schema validator

Implement one module that validates all registered provider schemas and fails boot on violation.

### Step 5: Standardize structured-output error logs

Add schema name/version and feature route fields to logs for faster triage.

## Manual validation checklist

1. Start app with schema registry check enabled.
2. Trigger one request per route:
- preflight
- semantic parser
- router
- planner
- slot extraction
3. Confirm no provider `response_schema` errors in logs.
4. Confirm malformed model output fails closed with targeted clarification, without legacy compatibility routing.

## Acceptance criteria

1. No production logs with schema incompatibility errors on supported routes.
2. All provider-facing schemas pass startup validator.
3. Each structured-output call references a versioned schema identifier.

## Risks and mitigations

- Risk: over-constraining schema reduces model flexibility.
- Mitigation: keep internal schema richer than provider schema; map and enrich after parse.

## Rollback plan

- Revert the deployment/commit introducing the schema regression, then redeploy.
- Keep schema validator in warn-only mode temporarily if hard-blocking startup during emergency.
