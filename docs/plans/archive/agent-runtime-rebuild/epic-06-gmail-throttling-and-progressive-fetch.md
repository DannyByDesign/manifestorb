# Epic 06: Gmail Throttling and Progressive Fetch

Status: Planned
Priority: P1
Depends on: Epics 03, 04

## Objective

Reduce latency and prevent Gmail `429 rateLimitExceeded` bursts by controlling per-user concurrency and data-fetch breadth.

## Problem statement

Current behavior fetches broad result sets for simple requests and triggers concurrent retrieval retries, causing slow response and partial data.

## In scope

- Add per-user Gmail concurrency guard.
- Use metadata-first retrieval for read-only lookup flows.
- Reduce default fanout for basic factual intents.

## Out of scope

- Provider-wide quota management outside Gmail path.
- Deep caching overhaul.

## Affected code

- `src/server/integrations/google/message.ts`
- `src/server/integrations/google/retry.ts`
- `src/server/features/ai/capabilities/email.ts`

## Implementation plan

### Step 1: Add per-user concurrency limiter

- Introduce low concurrency cap for `getMessagesBatch` retries.
- Queue or defer excess requests for same user key.

### Step 2: Progressive fetch model

Read request strategy:
1. list IDs/metadata minimal
2. select target subset
3. fetch full payload only for selected IDs

### Step 3: Intent-aware limits

- For "first/latest" prompts use small limit (for example 3-5)
- Avoid default broad fetch of 25 when not needed

### Step 4: Retry hardening

- Keep bounded retries
- add jitter and per-user backoff alignment
- avoid synchronized retry storms

## Manual validation checklist

1. Repeatedly send simple read prompt under load.
2. Confirm no burst of repeated 429 logs for same request.
3. Confirm latency improves for direct read lane.

## Acceptance criteria

1. Significant drop in Gmail 429 error frequency for read-lookups.
2. Direct factual responses return within target latency budget.
3. Missing-message retry queue no longer dominates request duration.

## Risks and mitigations

- Risk: lower fetch breadth can miss target item if ordering unclear.
- Mitigation: explicit deterministic ordering and controlled fetch expansion.

## Rollback plan

- Revert deployment/commit if progressive fetch introduces correctness regressions.
