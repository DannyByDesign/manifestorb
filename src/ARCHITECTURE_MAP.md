# Source Architecture Map

This file is the fast orientation map for `src/`.

## Top-Level

```
src/
├── app/          # Next.js pages + API routes (public runtime entrypoints)
├── server/       # Backend runtime, domain services, provider integrations
├── components/   # UI components (landing + 3D experience)
├── lib/          # Client/shared UI helpers
├── enterprise/   # Billing/Stripe helpers
├── shaders/      # GLSL shader assets
├── env.ts        # Environment schema
└── proxy.ts      # Edge proxy entry
```

## Assistant Runtime Path

1. `src/app/api/chat/route.ts` (web chat)
2. `src/app/api/surfaces/inbound/route.ts` (surface bridge)
3. `src/server/features/channels/executor.ts`
4. `src/server/features/ai/message-processor.ts`
5. `src/server/features/ai/runtime/*`
6. `src/server/features/ai/tools/*`
   - registry: `src/server/features/ai/tools/runtime/capabilities/registry.ts`
   - tool executors: `src/server/features/ai/tools/runtime/capabilities/executors/*`

## Inbound Inbox Automation Path

1. `src/app/api/google/webhook/route.ts`
2. `src/app/api/google/webhook/process-history.ts`
3. `src/server/features/webhooks/process-history-item.ts`
4. `src/server/features/policy-plane/automation-executor.ts`

## Calendar Sync Path

1. `src/app/api/google/calendar/webhook/route.ts`
2. `src/server/features/calendar/sync/google.ts`
3. `src/server/features/calendar/sync/microsoft.ts`
4. `src/server/features/calendar/canonical-state.ts`

## Domain Ownership (server/features)

- `ai`: turn runtime, skills, tool assembly, policy enforcement.
- `approvals`: approval creation/decision/execution.
- `assistant-email`: assistant-via-email logic (`user+assistant@...`).
- `calendar`: availability, sync, scheduling, event orchestration.
- `categorize`: sender categorization.
- `channels`: channel/surface orchestration.
- `email`: provider abstraction + mail operations.
- `memory`: long-term memory and embeddings.
- `policy-plane`: canonical policy/rule compile + PDP.
- `tasks`: task triage APIs.
- `webhooks`: inbound provider webhook processing.

## Legacy/Secondary Surface

`src/server/actions` is a legacy next-safe-action surface. It is not on the main runtime path for inbox/calendar assistant execution.
