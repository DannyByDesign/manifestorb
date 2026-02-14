# Server Architecture

`src/server` contains backend runtime, domain services, and platform integrations.

See `src/ARCHITECTURE_MAP.md` for cross-`src` runtime entrypoint mapping.

## Top-Level Structure

```
server/
├── auth/            # Session/authn helpers
├── db/              # Prisma client wiring
├── features/        # Domain modules (AI, email, calendar, approvals, policy-plane)
├── integrations/    # Google/Microsoft/Slack API clients
├── lib/             # Cross-domain utilities
├── packages/        # Internal packages (@amodel/*)
├── scripts/         # Maintenance/backfill scripts
├── types/           # Shared server-side types
└── actions/         # Legacy next-safe-action surface (not core runtime path)
```

## Core Runtime Path

Primary user turn flow:

1. API entrypoints in `src/app/api` (`/chat`, `/surfaces/inbound`, webhook routes)
2. `src/server/features/channels/executor.ts`
3. `src/server/features/ai/message-processor.ts`
4. `src/server/features/ai/runtime/*`
5. Tool execution via `src/server/features/ai/tools/*`
   - metadata registry: `src/server/features/ai/tools/runtime/capabilities/registry.ts`
   - tool executors: `src/server/features/ai/tools/runtime/capabilities/executors/*`
   - provider adapters: `src/server/features/ai/tools/providers/*`

Approval and policy gates:

- Policy evaluation: `src/server/features/policy-plane/*`
- Runtime enforcement: `src/server/features/ai/policy/enforcement.ts`
- Approval execution: `src/server/features/approvals/*`

## Domain Ownership

- `features/ai`: runtime loop, skills prompt composition, tool assembly.
- `features/email`: provider abstraction and email operations.
- `features/calendar`: availability, sync, scheduling, calendar provider logic.
- `features/policy-plane`: canonical policy/rule compilation and decisioning.
- `features/approvals`: HITL approval lifecycle and execution replay.
- `features/webhooks`: inbound mailbox event processing.
- `features/assistant-email`: assistant-via-email handling (`user+assistant@...` path).

## Import Conventions

```ts
import prisma from "@/server/db/client";
import { createScopedLogger } from "@/server/lib/logger";
import { processMessage } from "@/features/ai/message-processor";
import { createEmailProvider } from "@/features/email/provider";
```

Use `@/features/*` for domain code, `@/server/*` for platform infrastructure.
