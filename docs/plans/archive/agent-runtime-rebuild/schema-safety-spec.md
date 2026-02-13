# Schema Safety Spec (Provider-Facing Structured Output)

Status: Mandatory
Scope: every `generateObject` call used in orchestration, routing, semantic parsing, slot extraction, and planning.

## Objective

Prevent runtime schema rejections such as:
- `Transforms cannot be represented in JSON Schema`
- `... OBJECT type should be non-empty for properties`
- enum type incompatibilities in provider `response_schema`

## Current code hotspots

- `src/server/features/ai/orchestration/preflight.ts`
- `src/server/features/ai/skills/router/parse-request.ts`
- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/slots/resolve-slots.ts`
- `src/server/features/ai/planner/plan-schema.ts`
- `src/server/features/ai/planner/build-plan.ts`

## Hard rules

1. Do not use `z.transform(...)` in any schema passed to `generateObject`.
2. Do not use `z.record(z.string(), z.unknown())` in provider-facing schemas.
3. Do not use union branches that compile to unconstrained object types.
4. For each object branch in any union, define explicit non-empty `properties`.
5. Prefer narrow discriminated unions over broad `unknown` records.
6. Use explicit enums with provider-compatible primitive types.
7. Keep schema depth and union complexity minimal.
8. Every provider-facing schema must be versioned and named.

## Allowed value patterns for provider-facing schemas

- `string`
- `number`
- `integer`
- `boolean`
- arrays of primitive values
- objects with explicit required/optional keys
- discriminated unions with explicit object branches

## Disallowed patterns

- transformed values
- catch-all objects
- dynamic key maps without bounded keys
- implicit `any`/`unknown` at schema boundary
- nested unions containing empty object branches

## Compatibility strategy

1. Maintain an internal rich schema when needed.
2. Create a separate provider-safe schema for `generateObject`.
3. Parse provider output into internal schema in a second validation step.
4. If conversion fails, log structured reason and fail closed with a targeted clarification response.

## Startup safety gate

Add a schema registry validator that runs at boot:
- Registry lists all provider-facing schemas.
- Validator rejects forbidden patterns.
- App startup fails if any provider-facing schema violates this spec.

## Change checklist (required in PR description)

- [ ] I did not add `z.transform` to provider-facing schema.
- [ ] I did not use open-ended `z.record(..., z.unknown())` in provider-facing schema.
- [ ] All object union branches have explicit non-empty properties.
- [ ] Schema version and owner documented.
- [ ] Invalid model output fails closed and does not route through legacy compatibility logic.

## Logging requirements

For each structured-output failure log:
- schema name
- schema version
- feature label
- request route (`preflight`, `router`, `parser`, `planner`, `slots`)
- provider/model
- compact validation error summary

Never log raw user secrets or full provider payloads.

## Rollback policy

If schema failures spike in production:
1. Revert the last deployment/commit that introduced the schema regression.
2. Keep policy checks enabled.
3. Ship schema fix and redeploy.
