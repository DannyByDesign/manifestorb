# Server-Side Architecture

The `src/server` directory contains the backend logic of the application, organized into distinct layers.

## Directory Structure

```
server/
├── actions/          # Server actions (next-safe-action handlers)
├── auth/             # Authentication (better-auth)
├── db/               # Database (Prisma client, extensions)
├── features/         # Feature modules (domain logic)
├── integrations/     # External API clients
├── lib/              # Shared utilities
├── packages/         # Internal packages (@amodel/*)
├── scripts/          # Utility scripts
└── types/            # Shared TypeScript types
```

## Layer Descriptions

### 1. `actions/` (Server Actions)
Next-safe-action handlers for authenticated mutations.
- `rule.ts` - Rule CRUD operations
- `mail.ts` - Email operations
- `calendar.ts` - Calendar operations
- `drive.ts` - Drive operations
- `validation/` - Zod schemas for each action

### 2. `features/` (Feature Modules)
Self-contained domain logic organized by feature.
- **`ai/`** - AI orchestration, tools, and security
- **`web-chat/`** - Web UI chat assistant (rule management focus)
- **`channels/`** - Multi-channel executor (Slack/Discord/Telegram); one-shot agent runtime
- **`email/`** - Email provider abstraction
- **`rules/`** - Automation rule engine
- **`approvals/`** - Human-in-the-loop workflow; secure action tokens for approval links
- **`calendar/`**, **`drive/`** - Calendar/Drive (watch, renewal cron, conflict resolution; drive delete file/folder)
- **`tasks/`** - Task triage, panel API, approval-backed actions
- **`notifications/`** - In-app and push notifications
- **`memory/`** - RLM memory, embeddings, summaries
- And more...

### 3. `integrations/` (External API Clients)
Pure API wrappers with no business logic.
- **`google/`** - Gmail, Calendar, Drive, People APIs
- **`microsoft/`** - Microsoft Graph API
- **`qstash/`** - Upstash queue service

### 4. `lib/` (Shared Utilities)
Cross-cutting utilities used by multiple features.
- **`llms/`** - LLM provider abstraction
- **`redis/`** - Caching utilities
- **`queue/`** - Queue utilities
- **`parse/`** - Email/HTML parsing
- **`logger.ts`** - Structured logging
- **`error.ts`** - Error handling

### 5. `db/` (Database)
Prisma client and extensions.
- `client.ts` - Prisma client instance
- `encryption.ts` - Token encryption

### 6. `auth/` (Authentication)
Better-auth configuration and utilities.

### 7. `packages/` (Internal Packages)
Standalone packages used by the application.
- `@amodel/resend` - Email templates
- `@amodel/cli` - CLI tool

### 8. `scripts/` (Utility Scripts)
Migration and verification scripts.

## Import Conventions

```typescript
// Features
import { createAgentTools } from "@/features/ai/tools";
import { aiProcessAssistantChat } from "@/features/web-chat/ai/chat";

// Integrations
import { getGmailClient } from "@/integrations/google/client";

// Utilities
import { createScopedLogger } from "@/server/lib/logger";

// Database
import prisma from "@/server/db/client";

// Actions
import { createRuleAction } from "@/actions/rule";
```

## Adding New Features

1. Create `features/[feature-name]/`
2. Add domain logic files
3. If AI-powered, add `features/[feature-name]/ai/`
4. Add validation schemas to `actions/validation/`
5. Add server actions to `actions/[feature-name].ts`
6. Add API routes to `app/api/[feature-name]/`

See root `ARCHITECTURE.md` for the full architecture guide.
