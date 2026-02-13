# Capability Graph Quality Gates

Status: Active  
Applies To: Skills router + planner fallback + deterministic executor

## Behavioral Gates

1. Task success rate (top 25 inbox/calendar scenarios): `>= 95%`
2. Incorrect action/tool selection rate: `<= 2%`
3. Clarification rate on clearly specified requests: `<= 10%`
4. User correction within 10 minutes of action: `<= 5%`
5. Unsupported response for actually supported capability: `<= 3%`
6. Safety boundary violations: `0`

## Execution Integrity Gates

1. Every mutating action passes policy/approval check before execution.
2. Every executed capability invocation passes schema validation.
3. Planner steps execute only after dependency validation.
4. Planner graph cycle detection blocks execution deterministically.
5. Approval-required actions persist immutable request payload and idempotency key.

## Continuation and State Gates

1. Clarification follow-up resumes same pending run state before fresh reroute.
2. Pending run state expires deterministically and cannot execute expired contexts.
3. Pending state correlation includes user + account + conversation context.

## Observability Gates

Required telemetry per turn:

1. `routeType` (`skill|planner|clarify`)
2. `reason` (router/planner route reason)
3. `candidateCount` for planner route
4. plan validation failures (code + message)
5. step-level capability, success/failure, policy block signal
6. clarification depth / continuation resumes

## Rollback Triggers

1. Safety violations > 0 in canary window.
2. Incorrect action rate > 2% for 2 consecutive windows.
3. Planner clarification loops > 2 turns median for long-tail intents.
4. Approval workflow dead-end incidents > 0.
