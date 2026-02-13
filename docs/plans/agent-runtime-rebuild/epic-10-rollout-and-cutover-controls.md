# Epic 10: Clean Cutover and Legacy Deletion

Status: Planned
Priority: P0 for release
Depends on: Epics 01-09

## Objective

Perform a single clean cutover to the rebuilt runtime and delete legacy/compatibility code paths to keep the codebase minimal and maintainable.

## Problem statement

Keeping dual runtime paths and compatibility shims increases complexity, creates divergent behavior, and slows down future development.

## In scope

- One-way cutover to rebuilt runtime path.
- Delete obsolete runtime branches and adapters.
- Add a post-cutover cleanup checklist to ensure dead code is removed.

## Out of scope

- Long-term canary infrastructure.
- Runtime feature-flag matrix for permanent dual operation.

## Cutover strategy

### Stage 0: Release freeze window

- lock AI runtime changes outside this epic
- finalize migration PR stack

### Stage 1: Hard cutover deploy

- deploy rebuilt runtime as only active path
- verify startup schema gate and critical smoke prompts

### Stage 2: Immediate legacy code deletion

- remove old orchestration branches no longer used
- remove compatibility-only adapters and path routing
- remove dead configuration branches and docs references

### Stage 3: Post-cutover verification

- run critical manual flow checklist
- confirm no references to removed paths remain
- confirm policy enforcement still active for all mutations

## Legacy deletion checklist

- [ ] Remove obsolete runtime entry points superseded by rebuilt flow.
- [ ] Remove compatibility adapters retained only for phased migration.
- [ ] Remove dead flags/config toggles for removed paths.
- [ ] Remove dead docs and comments that describe removed architecture.
- [ ] Ensure imports/build graph no longer references deleted modules.

## Operational metrics to watch immediately after cutover

- structured-output schema error count by route
- planner build failure rate
- basic factual request success rate
- Gmail 429 rate per user
- end-to-end latency (p50/p95)
- policy block/approval event rates

## Cutover gate checklist

- [ ] Zero provider schema incompatibility errors during cutover validation.
- [ ] Basic factual prompts answer correctly in one turn.
- [ ] Planner path handles supported long-tail requests without generic plan-build failures.
- [ ] Policy parity is preserved between direct skill and planner mutation flows.
- [ ] Legacy runtime code paths are deleted from repository.

## Rollback runbook (deployment-level only)

1. Revert the cutover deployment to prior known-good commit.
2. Investigate root cause and patch forward.
3. Re-run cutover checklist before redeploying.

## Acceptance criteria

1. Rebuilt runtime is the only active runtime path.
2. Legacy compatibility code is removed.
3. Post-cutover verification passes for core inbox/calendar requests.
