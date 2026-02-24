# Backend MVP Launch Audit (Gmail + Google Calendar + Conversational Secretary + Rule Plane + Web Search)

**Date:** 2026-02-24
**Scope audited:** `src/server/**/*`, `src/app/api/**/*`, `src/env.ts`
**Coverage:** 808 backend files with per-file line spans.

## 1. MVP Contract Used For Audit

1. Gmail + Google Calendar only (no Microsoft/Slack/Discord/Telegram).
2. Conversational AI secretary for inbox + calendar execution.
3. Web search/fetch remains first-class (automation + reasoning support).
4. Rule plane is the control system for automations, approvals, guardrails, and preferences via natural language.
5. Backend-only audit; frontend is intentionally excluded from modifications.

## 2. Classification Summary

| Classification | Files | Lines | Meaning |
|---|---:|---:|---|
| KEEP_MVP_CORE | 495 | 62614 | Fits launch scope as-is |
| KEEP_REFACTOR_MVP | 90 | 18051 | Needed for MVP but has non-MVP branches to strip |
| DEFER_POST_MVP | 25 | 5987 | Optional for launch; move to post-MVP backlog |
| PRUNE_MVP | 198 | 33872 | Outside launch scope; prune/delete |

## 3. What Is Kept (Launch-Critical)

1. Runtime conversational secretary path (`src/server/features/ai/runtime/*`, `src/server/features/ai/message-processor.ts`) with single session loop.
2. Inbox capabilities (`email.*`) and calendar capabilities (`calendar.*`) in `src/server/features/ai/tools/runtime/capabilities/registry.ts`.
3. Web search and fetch capabilities (`web.search`, `web.fetch`) in `src/server/features/ai/tools/runtime/capabilities/web.ts`.
4. Rule plane core and APIs (`src/server/features/policy-plane/*`, `src/app/api/rule-plane/*`).
5. Approval/guardrail enforcement (`src/server/features/approvals/*`, policy enforcement in tool execution pipeline).
6. Google integration surfaces (`src/server/integrations/google/*`, `src/app/api/google/*`, plus Gmail/Calendar webhook and callback plumbing).

## 4. Guardrails & Tool Gating Kept

1. Deterministic policy-layer filtering remains (`profile`, `provider`, `agent`, `group`, `sandbox`, `subagent`).
2. Semantic tool candidate narrowing + adaptive tool limits remain.
3. Per-tool policy enforcement and approval-gated execution remains in runtime tool assembly (`src/server/features/ai/runtime/mcp-tools.ts`).
4. Tool schema validation, execution timeout, and blocked/approval outcomes remain.

## 5. Critical Misalignment Found (Needs Fix To Match Product Statement)

1. `policy.*` tools exist but are currently excluded from secretary runtime tool admission by hard prefix filter in `src/server/features/ai/runtime/session.ts` (currently only `email.`, `calendar.`, `task.`, `web.`).
2. Core email/calendar/provider files still include Microsoft/Outlook branches in multiple keep-path files; these must be stripped for true Gmail/Google-only launch.
3. Rule-plane learning path currently has coupling to groups subsystem (`src/server/features/policy-plane/learning-patterns.ts`), while groups is out-of-scope for launch and flagged prune.
4. Non-MVP surfaces/channel workers and APIs still occupy large backend footprint and should be removed to prevent drift and accidental routing.

## 6. PRUNE_MVP (Top Modules)

| Module | Files | Lines | Why not aligned |
|---|---:|---:|---|
| src/server/integrations/microsoft | 34 | 7183 | Microsoft/Outlook provider surface |
| src/server/workers | 26 | 5066 | Cross-surface runtime/transport not in MVP |
| src/server/features/search | 22 | 4570 | Unified search/index plane outside provider-first MVP path |
| src/server/features/reply-tracker | 19 | 3019 | Non-secretary vertical feature drift |
| src/server/features/email | 1 | 2059 | Out of launch scope |
| src/server/features/meeting-briefs | 8 | 1874 | Non-secretary vertical feature drift |
| src/server/features/channels | 9 | 1493 | Cross-surface runtime/transport not in MVP |
| src/app/api/surfaces | 12 | 1431 | Cross-surface runtime/transport not in MVP |
| src/server/features/follow-up | 7 | 1199 | Non-secretary vertical feature drift |
| src/server/features/calendar | 5 | 1099 | Out of launch scope |
| src/server/features/tasks | 6 | 791 | Task triage vertical outside inbox/calendar launch scope |
| src/server/features/categorize | 6 | 616 | Auxiliary classification/knowledge subsystem outside MVP |
| src/server/features/groups | 8 | 611 | Auxiliary classification/knowledge subsystem outside MVP |
| src/app/api/notifications | 10 | 585 | Notification subsystem outside chat-first MVP requirement |
| src/server/features/knowledge | 5 | 575 | Auxiliary classification/knowledge subsystem outside MVP |
| src/server/features/notifications | 5 | 546 | Notification subsystem outside chat-first MVP requirement |
| src/server/features/assistant-email | 4 | 422 | Out of launch scope |
| src/app/api/slack | 3 | 253 | Out of launch scope |
| src/app/api/search | 1 | 221 | Unified search/index plane outside provider-first MVP path |
| src/app/api/tasks | 3 | 142 | Task triage vertical outside inbox/calendar launch scope |
| src/server/integrations/slack | 3 | 110 | Out of launch scope |
| src/server/features/referrals | 1 | 7 | Out of launch scope |

## 7. DEFER_POST_MVP (Top Modules)

| Module | Files | Lines | Defer rationale |
|---|---:|---:|---|
| src/server/features/memory | 15 | 4616 | Long-term memory/embedding stack can ship post-MVP |
| src/app/api/jobs | 5 | 1056 | Background maintenance jobs tied to deferred subsystems |
| src/app/api/memory | 3 | 271 | Long-term memory/embedding stack can ship post-MVP |
| src/app/api/google | 1 | 24 | Google contacts enrichment is optional |
| src/app/api/context | 1 | 20 | Optional subsystem for post-MVP |

## 8. KEEP_REFACTOR_MVP (Top Modules To Clean, Not Remove)

| Module | Files | Lines | Required cleanup for MVP alignment |
|---|---:|---:|---|
| src/server/features/ai | 16 | 5685 | Remove non-MVP surface/provider conditionals and tests; keep secretary core. |
| src/server/lib | 22 | 3414 | Strip cross-surface and non-Google helper branches from shared infra. |
| src/server/features/calendar | 14 | 2430 | Remove Microsoft pathways while keeping Google calendar behavior. |
| src/server/features/policy-plane | 4 | 1455 | Decouple from pruned group/surface dependencies while preserving rule-plane. |
| src/app/api/approvals | 6 | 840 | Keep approval authority, remove non-MVP integration hooks. |
| src/server/features/email | 7 | 765 | Remove Outlook pathways while keeping Gmail behavior. |
| src/server/features/webhooks | 4 | 752 | Keep Gmail webhook automations, delete Outlook/assistant-email branches. |
| src/server/packages | 1 | 681 | In-scope core that needs branch cleanup. |
| src/server/features/approvals | 3 | 380 | Keep approval authority, remove non-MVP integration hooks. |
| src/server/integrations/google | 1 | 351 | In-scope core that needs branch cleanup. |
| src/env.ts | 1 | 314 | In-scope core that needs branch cleanup. |
| src/app/api/drafts | 2 | 229 | In-scope core that needs branch cleanup. |
| src/app/api/calendar | 1 | 184 | In-scope core that needs branch cleanup. |
| src/server/features/integrations | 2 | 184 | In-scope core that needs branch cleanup. |
| src/server/scripts | 1 | 143 | In-scope core that needs branch cleanup. |
| src/app/api/integrations | 1 | 78 | In-scope core that needs branch cleanup. |
| src/server | 1 | 63 | In-scope core that needs branch cleanup. |
| src/app/api/schedule-proposal | 1 | 50 | In-scope core that needs branch cleanup. |
| src/app/api/ambiguous-time | 1 | 41 | In-scope core that needs branch cleanup. |
| src/server/features/drafts | 1 | 12 | In-scope core that needs branch cleanup. |

## 9. Exhaustive File/Line-Level Appendices

1. Full backend audit matrix (all 808 files):
   - `docs/plans/appendix/2026-02-24-backend-mvp-audit.csv`
2. Non-aligned-only matrix (`KEEP_REFACTOR_MVP`, `DEFER_POST_MVP`, `PRUNE_MVP`):
   - `docs/plans/appendix/2026-02-24-backend-mvp-nonaligned.csv`
3. Prune-only list (`PRUNE_MVP`):
   - `docs/plans/appendix/2026-02-24-backend-mvp-prune-only.csv`

These appendices are the source of truth for “every line / every file” planning decisions for backend MVP pruning.
