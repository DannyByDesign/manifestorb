# Epic 07: User Response Contract Rewrite

Status: Planned
Priority: P0
Depends on: Epics 03, 04

## Objective

Ensure end users receive direct answers instead of internal execution step logs.

## Problem statement

Planner currently renders response text from internal step status lines, which is unacceptable for user-facing assistant behavior.

## In scope

- Introduce typed response contract per route type.
- Add response renderer layer.
- Preserve detailed step logs only for telemetry/debug.

## Out of scope

- Major conversation style changes.
- Tool-call telemetry redesign.

## Affected code

- `src/server/features/ai/planner/execute-plan.ts`
- `src/server/features/ai/planner/runtime.ts`
- `src/server/features/ai/skills/runtime.ts`
- `src/server/features/ai/message-processor.ts`

## Implementation plan

### Step 1: Define response envelopes

- `AnswerResponse`
- `ActionSummaryResponse`
- `ClarificationResponse`
- `PolicyBlockedResponse`

### Step 2: Separate execution and rendering

- execution returns structured machine result
- renderer builds user text by route and outcome type

### Step 3: Add factual answer templates

For direct read prompts include:
- the answer first
- key evidence fields
- optional follow-up suggestion

### Step 4: Keep internal step details out of default reply

- step list only in debug mode or hidden metadata

## Manual validation checklist

1. Execute direct-read prompt and verify concise factual answer.
2. Execute planner action and verify user-friendly summary.
3. Trigger policy block and verify actionable block message.

## Acceptance criteria

1. No default user response contains raw `[done] capability` step format.
2. Every route/outcome uses a typed response envelope.
3. Debug data remains available in telemetry but not in default user text.

## Risks and mitigations

- Risk: reduced transparency for power users.
- Mitigation: optional explicit debug command to expose step detail.

## Rollback plan

- Revert deployment/commit if renderer v2 introduces critical user-facing response regressions.
