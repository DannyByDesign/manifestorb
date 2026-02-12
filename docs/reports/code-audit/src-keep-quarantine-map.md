# Src Keep/Quarantine Map (Code-Derived)

Generated from runtime code paths in `src/app/api/**`, tool execution in `src/server/features/ai/tools/**`, and agent orchestration in `src/server/features/ai/message-processor.ts`.

## Decision Rules
- Keep: directly in the conversational assistant runtime path (chat/surfaces/tools/providers/approvals/notifications).
- Quarantine: dashboard-era or non-core launch functionality that increases failure surface.
- Keep (Future-Guarded): needed later (Microsoft), but currently gated/quarantined at runtime.

## Runtime Quarantine Actually Implemented
- Global path-level quarantine middleware:
  - `src/proxy.ts`
  - `src/lib/quarantine.ts`
- Default quarantined API prefixes:
  - `/api/ai/analyze-sender-pattern`
  - `/api/ai/compose-autocomplete`
  - `/api/ai/digest`
  - `/api/ai/summarise`
  - `/api/clean`
  - `/api/debug`
  - `/api/resend`
  - `/api/outlook`
  - `/api/jobs/cleanup-expired-rules`
  - `/api/jobs/purge-history`
  - `/api/jobs/summarize-conversation`
- Tool-resource quarantine (default ON unless `AMODEL_ENABLE_QUARANTINED_RESOURCES=true`):
  - `automation`, `knowledge`, `patterns`, `report`
  - enforced in `src/server/features/ai/tools/security.ts`

## `src/app` Map
- Keep:
  - `src/app/api/chat/route.ts`
  - `src/app/api/approvals/**`
  - `src/app/api/notifications/**`
  - `src/app/api/conversations/**`
  - `src/app/api/drafts/**`
  - `src/app/api/tasks/triage/**`
  - `src/app/api/ambiguous-time/**`
  - `src/app/api/schedule-proposal/**`
  - `src/app/api/google/**` (Google launch path)
  - `src/app/api/surfaces/**` (cross-channel conversational ingress)
  - `src/app/api/scheduled-actions/execute/route.ts`
  - `src/app/api/privacy/**`
  - `src/app/api/health/route.ts`
- Quarantine (now enforced by proxy):
  - `src/app/api/ai/analyze-sender-pattern/**`
  - `src/app/api/ai/compose-autocomplete/**`
  - `src/app/api/ai/digest/**`
  - `src/app/api/ai/summarise/**`
  - `src/app/api/clean/**`
  - `src/app/api/debug/**`
  - `src/app/api/resend/**`
  - `src/app/api/outlook/**`
  - `src/app/api/jobs/cleanup-expired-rules/**`
  - `src/app/api/jobs/purge-history/**`
  - `src/app/api/jobs/summarize-conversation/**`
- Keep (UI shell):
  - `src/app/connect/**`, `src/app/link/**`, `src/app/login/**`, `src/app/logout/**`
- Quarantine Candidate (not hard-disabled yet):
  - `src/app/accounts/page.tsx` (legacy post-link landing flow)

## `src/server/features` Map
- Keep (core conversational runtime):
  - `src/server/features/ai/**`
  - `src/server/features/approvals/**`
  - `src/server/features/calendar/**`
  - `src/server/features/channels/**`
  - `src/server/features/conversations/**`
  - `src/server/features/email/**`
  - `src/server/features/notifications/**`
  - `src/server/features/tasks/**`
  - `src/server/features/privacy/**`
  - `src/server/features/memory/**`
  - `src/server/features/web-chat/**`
  - `src/server/features/rules/**` (user-defined boundaries/rules)
  - `src/server/features/scheduled/**`
  - `src/server/features/webhooks/**`
- Keep (future-guarded / expansion path):
  - Microsoft providers under calendar/email integrations (runtime-route quarantined via `/api/outlook`)
- Quarantine Candidate (non-core for inbox/calendar assistant launch):
  - `src/server/features/clean/**`
  - `src/server/features/digest/**`
  - `src/server/features/categorize/**`
  - `src/server/features/categories/**`
  - `src/server/features/cold-email/**`
  - `src/server/features/groups/**`
  - `src/server/features/reports/**`
  - `src/server/features/meeting-briefs/**`
  - `src/server/features/snippets/**`
  - `src/server/features/follow-up/**`
  - `src/server/features/referrals/**`
  - `src/server/features/premium/**`
  - `src/server/features/organizations/**`
  - `src/server/features/mcp/**` (empty/unused)

## `src/server/actions` and non-core platform code
- Keep selectively for currently wired flows (`rules`, `knowledge`, `group`, etc.).
- Quarantine Candidate for launch simplification:
  - admin/billing/referral/org/sso/dashboard-oriented actions not called by assistant runtime.

## `src/components`, `src/hooks`, `src/lib`, `src/shaders`
- Keep:
  - `src/hooks/use-notification-poll.ts`
  - `src/components/client-notification-provider.tsx`
  - auth/integration helpers in `src/lib/**` used by API routes.
- Quarantine Candidate:
  - heavy visual/3D presentation stack not tied to assistant reliability (`src/components/experience/**`, `src/shaders/**`).

## Operational Guidance
- Quarantine means "disabled at runtime and excluded from core reliability SLO".
- Do not delete quarantined code yet; keep for controlled re-introduction behind explicit flags/tests.
