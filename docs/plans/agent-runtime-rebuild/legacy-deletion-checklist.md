# Legacy Deletion Checklist (Post-Cutover)

Status: Required
Owner: AI runtime team
Depends on: Epics 01-10 complete

## Goal

Delete obsolete code paths and compatibility scaffolding after runtime cutover to keep the codebase clean and prevent behavior drift.

## Deletion principles

1. Delete before deprecating when there are no active users on the old path.
2. Prefer hard removal over hidden flags.
3. Keep only migration code needed for data integrity, and time-box its removal.
4. Remove stale docs/config together with code.

## Candidate deletion targets

### Runtime and orchestration

- Remove old/duplicate orchestration entry points superseded by current skills/planner runtime.
- Remove code branches that preserve obsolete tool-loop behavior no longer used in production path.
- Remove dead continuation branches not referenced by current message processor flow.

### Routing and parsing

- Remove compatibility routing branches that exist only to emulate old behavior.
- Remove parser adapters that translate between old and new semantic contracts.

### Planner and executor

- Remove legacy plan builders/validators replaced by typed-capability planner.
- Remove old result formatting logic that exposes internal step traces by default.

### Policy and approvals

- Remove compatibility policy adapters retained only for phased parity checks.
- Remove stale approval context mappers that duplicate canonical mapping.

### Config and flags

- Delete one-time migration flags and any toggle for removed runtime paths.
- Delete unused env vars and wiring from startup/config docs.

### Docs and runbooks

- Remove obsolete architecture docs describing deleted pipelines.
- Update source-of-truth docs to reference only active runtime.

## Verification checklist

- [ ] `rg` search shows no references to removed runtime module names.
- [ ] build graph/import graph has no dead imports.
- [ ] startup path references only rebuilt runtime.
- [ ] policy enforcement still active on all mutating capabilities.
- [ ] core manual prompts pass with new runtime only.

## Manual verification commands

Use repo-local checks after deletions:

1. `rg -n "legacy|deprecated|compat|old_tool_loop|old_orchestration" src docs`
2. `rg -n "FF_|feature flag|toggle" src docs`
3. `npm run build` (or repo build command)
4. targeted runtime smoke checks for inbox read, inbox mutation approval, calendar mutation, rule-plane action

## Exit criteria

1. No code path remains that can route execution through deleted architecture.
2. No compatibility-only flags remain for runtime path selection.
3. Documentation and implementation match one active architecture.
