# Epic 03: Direct Read-Intent Lane (No Planner for Basic Facts)

Status: Planned
Priority: P0
Depends on: Epics 01, 02

## Objective

Add a deterministic high-confidence lane for simple inbox/calendar factual requests so they do not route into planner fallback.

## Problem statement

The system currently routes requests like "what is the first email in my inbox" to planner fallback, which may fail or return internal step logs instead of user answers.

## In scope

- Add read-lookup intent family.
- Add deterministic router path for basic factual requests.
- Add direct capability execution for those requests.

## Out of scope

- Complex multi-action planning.
- Mutation workflows.

## Affected code

- `src/server/features/ai/skills/router/route-skill.ts`
- `src/server/features/ai/skills/router/parse-request.ts`
- `src/server/features/ai/skills/baseline/index.ts`
- `src/server/features/ai/skills/executor/execute-skill.ts`
- `src/server/features/ai/capabilities/email.ts`

## Implementation plan

### Step 1: Define read-lookup intents

Canonical read intents:
- first item in inbox
- latest item in inbox
- oldest unread
- first meeting today
- next meeting today

### Step 2: Add deterministic routing rules

Before planner fallback:
- if prompt matches simple factual pattern and entities are resolvable, route to direct read lane.
- keep planner for unresolved long-tail requests.

### Step 3: Add direct read capability mapping

Use minimal capabilities:
- `email.searchInbox` with constrained limit and ordering
- calendar list/find operations for basic meeting queries

### Step 4: Return typed answer object

Output contract for direct-read lane:
- `answerText`
- `item` (id, subject/title, sender/attendee, timestamp)
- `confidence`
- `evidence`

### Step 5: Clarification behavior

When read target is ambiguous, return targeted question:
- example: "Do you mean first by newest received time or oldest?"

## Manual validation checklist

1. Ask "what is the first email in my inbox".
2. Verify route type is not planner.
3. Verify response includes actual first email attributes.
4. Ask "what's my next meeting" and verify same direct lane behavior.

## Acceptance criteria

1. Basic factual requests are answered directly without planner.
2. No response shows internal execution list formatting for these requests.
3. Clarification prompts are specific when ambiguity exists.

## Risks and mitigations

- Risk: rule overfitting for phrasing variants.
- Mitigation: combine deterministic phrase set with lightweight semantic normalization.

## Rollback plan

- Revert deployment/commit if direct-read route introduces correctness regressions.
