# Skills Telemetry Acceptance Review

Last updated: 2026-02-13

This template is used to review production/staging telemetry after each autonomy rollout.

## Inputs

- Time window:
- Environment:
- Build SHA:
- Total skill turns:

## Required Metrics

1. Clarification rate
- Definition: `% of turns ending in clarify response`
- Target: `<= 10%` on clearly specified requests
- Observed:

2. Policy block rate
- Definition: `% of mutating turns blocked by approval/policy`
- Interpretation:
  - high + expected means guardrails are active
  - high + unexpected means routing/slot issues or over-restrictive policy
- Observed:

3. Provider transient failure rate
- Definition: `% of turns with transient diagnostics (rate_limit/timeout/temporary)`
- Target: stable; track p95 spikes
- Observed:

4. User correction signals
- Definition: `% of turns where user corrects or repeats failed intent within 10 minutes`
- Target: `<= 5%`
- Observed:

5. Unsupported false-success rate
- Definition: `% of unsupported operations reported as success`
- Target: `0%`
- Observed:

## Event Schema Verification

- [ ] `skill.route.completed` has:
  - requestId
  - semanticParseConfidence
  - routedFamilies
  - unresolvedEntities
- [ ] `skill.execution.completed` has:
  - stepGraphSize
  - capabilityChain
  - policyBlockCount
  - postconditionPassRate
  - repairAttemptCount
  - finalOutcome
- [ ] `skill.action.completed` has:
  - capability
  - policyDecision
  - itemCount
  - errorCode (when failed)

## Outcome Summary

- Supported scenario completion:
- Incorrect/destructive action rate:
- Clarification rate on clear requests:
- Policy bypass incidents:
- Decision: `GO` / `NO-GO`
- Reviewer:

