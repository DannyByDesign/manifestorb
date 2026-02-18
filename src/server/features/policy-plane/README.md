# Policy Plane (`src/server/features/policy-plane`)

Canonical policy compilation + decisioning (PDP) and automation execution.

Responsibilities:
- compile user rules/policies into a canonical representation
- evaluate events (emails, schedules, etc.) against policy
- execute automation actions safely (often via capability layers)
- log decisions and executions for audit/debug

## Key Files

- `compiler.ts`: compiles user config/rules into canonical policy
- `pdp.ts`: policy decision point (evaluate a request/event)
- `automation-executor.ts`: execute automation actions after decisioning
- `repository.ts`: persistence access patterns for canonical policy artifacts
- `policy-logs.ts`: logging and audit helpers
- `canonical-schema.ts`: canonical policy schema/types

