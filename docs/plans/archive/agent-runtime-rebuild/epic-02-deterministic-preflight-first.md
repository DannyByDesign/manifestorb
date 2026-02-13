# Epic 02: Deterministic Preflight First

Status: Planned
Priority: P0
Depends on: Epic 01

## Objective

Move preflight to deterministic-first logic for operational requests and use LLM preflight only as a narrow ambiguity resolver.

## Problem statement

Preflight currently makes provider-structured calls that can fail and add avoidable latency, even for obvious operational intents.

## In scope

- Reorder preflight decision flow.
- Make deterministic operational detection authoritative for clear inbox/calendar asks.
- Keep an optional LLM preflight branch for ambiguous conversational cases.

## Out of scope

- Full router redesign.
- Planner argument schema work.

## Affected code

- `src/server/features/ai/orchestration/preflight.ts`
- `src/server/features/ai/message-processor.ts`

## Implementation plan

### Step 1: Define deterministic preflight matrix

Decision dimensions:
- resource token present
- action/lookup verb present
- pending approval continuation present
- conversational short-turn pattern

Outputs:
- `needsTools`
- `mode`
- `contextTier`

### Step 2: Narrow LLM preflight usage

Call LLM preflight only when:
- deterministic matrix returns `ambiguous`
- no pending continuation state exists

### Step 3: Stabilize `contextTier`

Use strict primitive type and remove transform logic in provider-facing schema.

### Step 4: Add explicit branch telemetry

Log branch selected:
- `deterministic_operational`
- `deterministic_conversational`
- `llm_ambiguity_resolution`
- `deterministic_default`

## Manual validation checklist

1. Send operational prompt: "what is the first email in my inbox".
2. Verify no LLM preflight call was made.
3. Send conversational prompt: "how are you".
4. Verify tools are not invoked.
5. Send ambiguous prompt and verify only that case uses LLM preflight.

## Acceptance criteria

1. Common operational prompts skip LLM preflight.
2. Conversational prompts do not enter skills/planner runtime.
3. Preflight no longer contributes schema-related failures.

## Risks and mitigations

- Risk: deterministic matrix misclassifies edge prompts.
- Mitigation: retain ambiguity branch and fail closed with targeted clarification.

## Rollback plan

- Revert deployment/commit if deterministic ordering causes severe regression.
