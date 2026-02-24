# Backend MVP Cleanup Implementation Plan (Gmail + Google Calendar + Slack)

**Date:** 2026-02-24  
**Scope:** Backend only (`src/server/**/*`, `src/app/api/**/*`, `src/env.ts`)  
**Source-of-truth audit appendices:**
1. `docs/plans/appendix/2026-02-24-backend-mvp-audit.csv`
2. `docs/plans/appendix/2026-02-24-backend-mvp-nonaligned.csv`
3. `docs/plans/appendix/2026-02-24-backend-mvp-prune-only.csv`

## 1. MVP Boundary

Launch backend supports only:
1. Gmail + Google Calendar provider capabilities.
2. Slack as external channel/surface.
3. Conversational AI secretary for inbox + calendar.
4. Rule plane for automations, approvals, guardrails, and preferences from natural language.
5. Web search/fetch for assistant and automation workflows.

Everything else is either pruned or deferred.

## 2. Current Baseline From Audit

1. `KEEP_MVP_CORE`: `523 files / 66,324 lines`
2. `KEEP_REFACTOR_MVP`: `111 files / 21,761 lines`
3. `DEFER_POST_MVP`: `25 files / 5,987 lines`
4. `PRUNE_MVP`: `149 files / 26,452 lines`

## 3. Critical Misalignments To Fix First

1. `policy.*` tool admission mismatch:
   - Runtime hard-prefix filter excludes `policy.*` while product requires rule-plane control in assistant loop.
   - File: `src/server/features/ai/runtime/session.ts`
2. Residual Outlook branches in core paths:
   - Gmail/Google-only MVP conflicts with Microsoft branches in provider/runtime files.
   - Key files: `src/server/features/ai/tools/providers/email.ts`, `src/server/features/ai/tools/providers/calendar.ts`, `src/server/features/email/provider.ts`, `src/server/features/calendar/event-provider.ts`.
3. Rule-plane coupling to pruned groups:
   - Rule-plane learning path depends on groups subsystem flagged for prune.
   - File: `src/server/features/policy-plane/learning-patterns.ts`
4. Slack path not hard-isolated:
   - Surfaces/channels code still includes Discord/Telegram branches.
   - Key files: `src/server/features/channels/*`, `src/app/api/surfaces/*`, `src/server/workers/surfaces/*`.

## 4. Execution Strategy

1. Hard-cut cleanup (no legacy fallback branches retained in runtime path).
2. Delete before adapt when module is explicitly out-of-scope.
3. Preserve runtime/tooling guardrails while reducing tool and code-surface entropy.
4. Apply changes in dependency order so compile/test remains green at each phase.

## 5. Workstream Plan

## WS0: Tool Admission + Rule Plane Alignment (Critical Misalignment #1)

Objective:
1. Ensure assistant can use rule-plane tooling in the conversational loop.

Implementation:
1. Extend secretary tool admission prefixes in `src/server/features/ai/runtime/session.ts` to include `policy.`.
2. Revalidate policy tool-group mapping and allow/deny behavior in:
   - `src/server/features/ai/tools/policy/tool-policy.ts`
   - `src/server/features/ai/tools/policy/policy-resolver.ts`
   - `src/server/features/ai/policy/enforcement.ts`
3. Keep approval requirement semantics unchanged for mutating rule-plane operations.

Acceptance criteria:
1. Runtime tool catalog contains `policy.*` when request intent targets rule operations.
2. Approval-required rule mutations still block and create approval requests.
3. Existing policy-plane API and runtime tests pass.

## WS1: Google-Only Provider Hard Cut (Critical Misalignment #2)

Objective:
1. Remove all Microsoft/Outlook provider code paths from active backend.

Delete scope (from `PRUNE_MVP` matrix):
1. Entire `src/server/integrations/microsoft/*`.
2. Outlook provider files:
   - `src/server/features/email/providers/microsoft.ts`
   - `src/server/features/calendar/providers/microsoft.ts`
   - `src/server/features/calendar/providers/microsoft-events.ts`
   - `src/server/features/calendar/providers/microsoft-availability.ts`
   - `src/server/features/calendar/sync/microsoft.ts`

Refactor scope:
1. Convert provider factories to Google-only:
   - `src/server/features/email/provider.ts`
   - `src/server/features/email/provider-types.ts`
   - `src/server/features/calendar/event-provider.ts`
   - `src/server/features/calendar/client.ts`
2. Remove Outlook conditionals from runtime-facing provider adapters:
   - `src/server/features/ai/tools/providers/email.ts`
   - `src/server/features/ai/tools/providers/calendar.ts`
3. Remove Microsoft env knobs from `src/env.ts` once no longer referenced.

Acceptance criteria:
1. No imports from `src/server/integrations/microsoft/*` remain.
2. Type system reflects Google-only provider union for MVP runtime path.
3. Gmail/Google Calendar CRUD + search + reschedule tests pass.

## WS2: Slack-Only Channel/Surfaces Narrowing (Critical Misalignment #4)

Objective:
1. Keep Slack channel capability while deleting Discord/Telegram complexity.

Delete scope:
1. `src/server/workers/surfaces/connectors/discord/*`
2. `src/server/workers/surfaces/connectors/telegram/*`
3. Any Discord/Telegram-specific API payload handling in surfaces actions/transport.

Refactor scope:
1. Channels layer narrowed to Slack contract:
   - `src/server/features/channels/router.ts`
   - `src/server/features/channels/executor.ts`
   - `src/server/features/channels/surface-account.ts`
2. Surfaces APIs narrowed to Slack runtime usage:
   - `src/app/api/surfaces/inbound/route.ts`
   - `src/app/api/surfaces/actions/route.ts`
   - `src/app/api/surfaces/session/resolve/route.ts`
   - `src/app/api/surfaces/identity/route.ts`
3. Worker bootstrap simplified to Slack connector only:
   - `src/server/workers/surfaces/index.ts`
   - `src/server/workers/surfaces/utils.ts`
   - `src/server/workers/surfaces/transport/brain-ingress.ts`

Acceptance criteria:
1. Only Slack connector remains in worker startup path.
2. No Discord/Telegram tokens or platform branches in runtime transport logic.
3. Slack inbound/outbound + approval actions continue to work.

## WS3: Rule Plane Decoupling From Groups (Critical Misalignment #3)

Objective:
1. Keep rule-plane core while removing dependency on out-of-scope groups subsystem.

Implementation:
1. Remove or rewrite `src/server/features/policy-plane/learning-patterns.ts` to avoid `features/groups/*` calls.
2. If behavior must remain, store lightweight learning metadata directly on canonical rule artifacts/logs instead of group entities.
3. Validate compiler/repository/pdp paths remain independent of groups.

Acceptance criteria:
1. No imports from `src/server/features/groups/*` inside `src/server/features/policy-plane/*`.
2. Rule compile/create/update/disable/delete flows remain intact.

## WS4: PRUNE_MVP Module Deletion

Objective:
1. Delete explicitly out-of-scope modules from audit matrix.

Primary prune modules:
1. `src/server/features/search/*`
2. `src/server/features/reply-tracker/*`
3. `src/server/features/meeting-briefs/*`
4. `src/server/features/follow-up/*`
5. `src/server/features/categorize/*`
6. `src/server/features/groups/*`
7. `src/server/features/knowledge/*`
8. `src/server/features/notifications/*`
9. `src/app/api/notifications/*`
10. `src/server/features/tasks/triage/*`
11. `src/app/api/tasks/triage/*`
12. `src/server/features/assistant-email/*`
13. `src/server/features/referrals/*`
14. `src/app/api/search/unified/route.ts`

Execution rule:
1. Delete files exactly as listed in `docs/plans/appendix/2026-02-24-backend-mvp-prune-only.csv`.

Acceptance criteria:
1. Every `PRUNE_MVP` file removed or replaced with MVP-safe no-op route if external contract must temporarily exist.
2. No orphan imports from pruned modules.

## WS5: DEFER_POST_MVP Isolation

Objective:
1. Remove deferred features from critical runtime path without deleting optional code immediately.

Deferred modules:
1. `src/server/features/memory/*`
2. `src/app/api/memory/*`
3. Memory/search-related jobs under `src/app/api/jobs/*` flagged in audit.
4. `src/app/api/google/contacts/route.ts`
5. `src/app/api/context/attention/route.ts`

Implementation:
1. Gate entrypoints so deferred modules are not invoked by secretary runtime flows.
2. Remove scheduler references and runtime imports from core message flow.
3. Keep modules compile-safe behind explicit non-MVP boundary.

Acceptance criteria:
1. Secretary message path does not call deferred memory/search pipelines.
2. Build/test pass with deferred modules present but isolated.

## WS6: Env/Config Cleanup

Objective:
1. Remove config drift and reduce accidental activation of out-of-scope features.

Implementation:
1. Remove Microsoft/Discord/Telegram env vars from `src/env.ts` when unused.
2. Keep required vars for Google, Slack, Anthropic web tools, rule-plane, approvals.
3. Update docs and `.env.example` accordingly.

Acceptance criteria:
1. No dead env schema entries for removed subsystems.
2. App boots with minimal MVP env set.

## WS7: Test and Gate Refresh

Objective:
1. Align automated tests and CI scripts to MVP scope.

Implementation:
1. Delete tests for pruned modules.
2. Rewrite tests for Slack-only channels/surfaces behavior.
3. Add explicit regression suites for:
   - Gmail email search/find reliability
   - Google Calendar reschedule reliability
   - Rule-plane compile/apply + approval gating
   - Web search/fetch tool execution
4. Remove CI references to pruned modules and jobs.

Acceptance criteria:
1. `tsc`, lint, targeted runtime/tooling tests, and build all pass.
2. No test files import removed modules.

## 6. Sequenced Delivery Plan

Phase 1 (Critical alignment):
1. WS0 (policy tool admission)
2. WS3 (rule-plane decoupling)

Phase 2 (Provider/channel hard cuts):
1. WS1 (Google-only provider)
2. WS2 (Slack-only surfaces/channels)

Phase 3 (Prune and isolate):
1. WS4 (delete PRUNE_MVP)
2. WS5 (defer isolation)

Phase 4 (Stabilize):
1. WS6 (env cleanup)
2. WS7 (tests and quality gates)

## 7. Verification Checklist

1. `rg -n "microsoft|outlook" src/server src/app/api` only returns approved historical docs or zero runtime hits.
2. `rg -n "discord|telegram" src/server src/app/api` returns zero runtime hits.
3. Runtime tool catalog includes `policy.*` for policy-intent turns.
4. Slack inbound -> assistant reply -> approval action loop passes integration tests.
5. Gmail and Google Calendar end-to-end flows pass regression suite.

## 8. Deliverables

1. Updated backend audit report with Slack included in MVP keep scope.
2. Exhaustive per-file line-span appendices (already generated).
3. Cleanup PR sequence executed in the order above.
4. Final post-cleanup architecture summary documenting kept subsystems only.
