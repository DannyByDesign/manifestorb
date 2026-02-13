# Skills Outcome Taxonomy Dashboard Spec

Last updated: 2026-02-13

This defines dashboard panels required for Phase 6.

## Panels

1. Route confidence distribution
- Source: `skill.route.completed`
- Group by: `skillId`, `routedFamilies`
- Buckets: `0-0.5`, `0.5-0.7`, `0.7-0.85`, `0.85-1.0`

2. Clarification rate
- Source: route + slot resolution outcomes
- Formula: `clarify / total turns`

3. Policy block rate
- Source: `skill.execution.completed.policyBlockCount`
- Formula: `turns with policyBlockCount > 0 / total mutating turns`

4. Repair attempt pressure
- Source: `skill.execution.completed.repairAttemptCount`
- Formula: avg + p95 by capability

5. Postcondition pass rate
- Source: `skill.execution.completed.postconditionPassRate`
- Formula: avg by skill and by provider

6. Failure taxonomy
- Source: `skill.execution.completed.diagnosticsCategory`, `diagnosticsCode`
- Breakdown: stacked area + top reason codes table

7. Action-level reliability
- Source: `skill.action.completed`
- Group by: capability + policyDecision
- Metrics: success rate, avg itemCount, errorCode frequency

8. User correction loop
- Source: correlation of repeated intent turns within 10 minutes
- Metric: `% corrected turns after failed/blocked execution`

