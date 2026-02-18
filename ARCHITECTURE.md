# AModel Architecture

This document is the source of truth for how the codebase is organized and how requests flow through the system.

At a high level:
- The **main app** is a Next.js server in `src/`.
- The optional **surfaces sidecar** is a long-running service in `surfaces/` that connects Slack/Discord/Telegram and runs background jobs that do not fit serverless constraints.

For a fast "where do I start reading code" map, see `src/ARCHITECTURE_MAP.md`.

## Components

### Main App (Next.js)

Runtime code lives in:
- `src/app/` (routes + API endpoints)
- `src/server/` (backend/domain runtime)

The backend is organized into:
- `src/server/features/` domain modules (email, calendar, approvals, memory, notifications, policy-plane, etc.)
- `src/server/integrations/` provider clients (Google/Microsoft/Slack/QStash)
- `src/server/lib/` shared infrastructure utilities (logging, encryption, redis, queue, llms)

### Surfaces Sidecar (Optional)

`surfaces/` hosts:
- chat platform connectors (Slack Socket Mode, Discord gateway, Telegram polling)
- background workers (memory recording, embeddings, decay) and a scheduler

The sidecar forwards inbound platform messages to the main app via `POST /api/surfaces/inbound`.

### Data Stores

- PostgreSQL (+ pgvector): primary persistence (`prisma/schema.prisma`)
- Redis: caching/queues (and a local adapter via `docker-compose.dev.yml`)
- Upstash QStash: delayed/background delivery (notably notification fallbacks)

### Generated Code

Prisma client output is checked into `generated/prisma/` (see `prisma/schema.prisma` generator output).
Do not edit files under `generated/` directly; regenerate instead.

## Request Flows

### Web Chat Turn

1. `src/app/api/chat/route.ts`
2. `src/server/features/ai/message-processor.ts`
3. `src/server/features/ai/runtime/*` (turn compilation, tool admission, attempt loop, response contract)
4. Turn compilation (context-aware):
   - Lightweight context hydration: `src/server/features/ai/runtime/context/hydrator.ts` (`purpose: "compiler"`)
   - Compiler context slice: `src/server/features/ai/runtime/compiler-context.ts`
   - Turn compiler + contract: `src/server/features/ai/runtime/turn-compiler.ts`, `src/server/features/ai/runtime/turn-contract.ts`
5. Tool admission/pruning:
   - Registry + policy layers: `src/server/features/ai/tools/fabric/registry.ts`, `src/server/features/ai/tools/fabric/policy-filter.ts`
   - Candidate filtering + ranking (semantic when embeddings are available, lexical fallback): `src/server/features/ai/tools/fabric/semantic-tool-candidate.ts`
6. Capability execution via `src/server/features/ai/tools/runtime/capabilities/executors/*`
7. Mutations are guarded by policy + approvals (below)

Conversation-only turns are handled as native generation with tools disabled (no tool forcing), while tool-eligible turns run through the standard tool loop.

### Surfaces (Slack/Discord/Telegram) Turn

1. Sidecar receives a platform message (`surfaces/src/*`)
2. Sidecar forwards to main app: `POST src/app/api/surfaces/inbound/route.ts`
3. Main app runs the same AI runtime as web turns (via `features/channels/*` and `features/ai/*`)
4. Main app may return `InteractivePayload`s (draft previews, approval prompts) for platform-specific rendering

### Provider Webhooks (Inbox/Calendar)

- Gmail and Calendar push enter via `src/app/api/google/*` routes.
- The main app normalizes provider events and routes them through `src/server/features/webhooks/*`.
- Inbox automation decisions are evaluated/executed in `src/server/features/policy-plane/*`.

### Approvals (Human In The Loop)

The assistant can propose actions, but sensitive actions are gated:
- Signed action tokens: `src/server/features/approvals/action-token.ts`
- Approval lifecycle: `src/server/features/approvals/service.ts`
- Replay/execute: `src/server/features/approvals/execute.ts`

The AI runtime treats `send` (email) as DANGEROUS and requires explicit approval; many other mutations are CAUTION-gated and subject to policy checks.

### Notifications

Notifications are persisted to the DB and delivered through two paths:
- In-app: fetched by the web client
- Fallback push: scheduled via QStash; if still unclaimed it is pushed to the sidecar surfaces

See `src/server/features/notifications/README.md`.

### Memory Recording + Embeddings

- Memory recording trigger logic: `src/server/features/memory/service.ts`
- Recording work is executed in the sidecar when configured: `surfaces/src/jobs/recording-worker.ts`
- Embedding generation: `src/server/features/memory/embeddings/*` (OpenAI embeddings)

See `src/server/features/memory/ARCHITECTURE.md` and `surfaces/src/jobs/README.md`.

## Conventions

- Put domain logic in `src/server/features/<feature>/`.
- Put provider API wrappers in `src/server/integrations/<provider>/` (no business logic).
- Prefer `src/server/lib/` only for cross-domain primitives shared by many features.
- Add a `README.md` to new feature directories explaining purpose, entrypoints, and invariants.
