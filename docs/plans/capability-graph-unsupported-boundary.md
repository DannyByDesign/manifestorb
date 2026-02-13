# Capability Graph Unsupported Boundary

Status: Active  
Objective: Make unsupported requests explicit, actionable, and non-deceptive.

## Supported Boundary

Supported means:

1. A capability exists in `capabilities/registry.ts`
2. Input args can be schema-validated
3. Execution path exists in planner or baseline skills
4. Policy/approval constraints can be satisfied

## Unsupported Cases

Requests are unsupported when any of these are true:

1. No capability exists for the requested operation.
2. Required inputs cannot be obtained after bounded clarification.
3. Provider/API does not support the operation (hard surface limit).
4. Safety policy forbids execution and cannot be overridden by approval.

## Response Contract

When unsupported, assistant response must include:

1. What cannot be done (specific operation)
2. Why (missing capability, provider limit, policy constraint, or missing data)
3. Closest supported alternative
4. One concrete next step user can take now

## Never Allowed

1. Silent no-op presented as success.
2. Claiming action executed when no capability was invoked.
3. Infinite clarification loops for unsupported operations.

## Example Response Shape

```
I can’t <unsupported operation> because <specific reason>.
I can do <closest supported alternative> instead.
If you want, I can proceed with <alternative action> now.
```
