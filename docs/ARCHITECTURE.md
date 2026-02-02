# AModel Architecture

This document serves as the source of truth for the codebase organization.

## Directory Structure

```
src/
├── app/                      # Next.js App Router (routes, API endpoints)
├── components/               # React components (UI)
├── lib/                      # Frontend utilities (audio, capabilities, stores)
├── hooks/                    # React hooks
├── shaders/                  # WebGL/GLSL shaders
├── enterprise/               # Enterprise-only features (Stripe)
├── __tests__/                # Test files
└── server/                   # All backend code
    ├── actions/              # Server actions (next-safe-action handlers)
    │   ├── admin.ts          # Admin operations
    │   ├── api-key.ts        # API key management
    │   ├── calendar.ts       # Calendar operations
    │   ├── drive.ts          # Drive operations
    │   ├── email-account.ts  # Email account management
    │   ├── knowledge.ts      # Knowledge base operations
    │   ├── mail.ts           # Email operations
    │   ├── organization.ts   # Team/org management
    │   ├── rule.ts           # Rule CRUD
    │   ├── settings.ts       # User settings
    │   ├── user.ts           # User operations
    │   └── validation/       # Zod validation schemas
    │
    ├── auth/                 # Authentication (better-auth)
    │
    ├── db/                   # Database (Prisma client, extensions)
    │
    ├── features/             # Feature modules (domain logic)
    │   ├── ai/               # AI orchestration & tools
    │   │   ├── tools/        # AI tool definitions (query, get, modify, etc.)
    │   │   ├── helpers.ts    # Shared AI helpers
    │   │   ├── security.ts   # Prompt injection protection
    │   │   └── types.ts      # AI types
    │   │
    │   ├── approvals/        # Human-in-the-loop approval workflow
    │   │   ├── service.ts    # Approval request management
    │   │   └── types.ts      # Approval types
    │   │
    │   ├── bulk-actions/     # Bulk archive/trash operations
    │   │
    │   ├── calendar/         # Calendar integration
    │   │   └── ai/           # AI logic for calendar
    │   │
    │   ├── categorize/       # Sender categorization
    │   │   └── ai/           # AI logic for categorization
    │   │
    │   ├── channels/         # Multi-channel router (Slack, Discord, Telegram)
    │   │   ├── router.ts     # Message routing logic
    │   │   └── types.ts      # Channel types
    │   │
    │   ├── clean/            # Email cleaning feature
    │   │   └── ai/           # AI logic for cleaning
    │   │
    │   ├── cold-email/       # Cold email detection & blocking
    │   │
    │   ├── conversations/    # Conversation state management
    │   │   └── service.ts    # Conversation service
    │   │
    │   ├── digest/           # Email digest feature
    │   │   └── ai/           # AI logic for digest
    │   │
    │   ├── document-filing/  # Document filing to Drive
    │   │   └── ai/           # AI logic for filing
    │   │
    │   ├── drive/            # Drive integration
    │   │   └── providers/    # Drive provider implementations
    │   │
    │   ├── email/            # Core email service
    │   │   ├── providers/    # Email provider implementations
    │   │   │   ├── google.ts # Gmail provider
    │   │   │   └── microsoft.ts # Outlook provider
    │   │   ├── provider.ts   # Provider factory
    │   │   └── types.ts      # Email types
    │   │
    │   ├── follow-up/        # Follow-up tracking & drafts
    │   │
    │   ├── groups/           # Email grouping (newsletters, receipts)
    │   │   └── ai/           # AI logic for grouping
    │   │
    │   ├── knowledge/        # Knowledge base
    │   │   └── ai/           # AI logic for knowledge extraction
    │   │
    │   ├── mcp/              # Model Context Protocol agent
    │   │   └── ai/           # AI logic for MCP
    │   │
    │   ├── meeting-briefs/   # Meeting briefing generation
    │   │   └── ai/           # AI logic for briefings
    │   │
    │   ├── notifications/    # In-app notifications
    │   │   ├── create.ts     # Create notifications
    │   │   └── generator.ts  # Notification content generator
    │   │
    │   ├── organizations/    # Team/organization management
    │   │
    │   ├── premium/          # Premium subscription features
    │   │
    │   ├── privacy/          # User privacy settings
    │   │   └── service.ts    # Privacy settings service
    │   │
    │   ├── referrals/        # Referral system
    │   │
    │   ├── reply-tracker/    # Reply tracking & conversation status
    │   │   └── ai/           # AI logic for reply detection
    │   │
    │   ├── reports/          # Email analytics reports
    │   │   └── ai/           # AI logic for reports
    │   │
    │   ├── rules/            # Automation rules
    │   │   └── ai/           # AI logic for rule matching
    │   │
    │   ├── scheduled/        # Scheduled actions
    │   │
    │   ├── snippets/         # Email snippets
    │   │   └── ai/           # AI logic for snippets
    │   │
    │   ├── summaries/        # Conversation summarization
    │   │   └── service.ts    # Summary service
    │   │
    │   ├── surfaces/         # Multi-channel agent (Slack, Discord, Telegram)
    │   │   ├── executor.ts   # Agent execution with approval workflows
    │   │   └── context-manager.ts # Context pack builder
    │   │
    │   ├── web-chat/         # Web UI chat & email-based assistant
    │   │   ├── ai/           # AI logic (chat.ts, process-user-request.ts)
    │   │   ├── is-assistant-email.ts
    │   │   └── process-assistant-email.ts
    │   │
    │   └── webhooks/         # Webhook processing (Gmail/Outlook push)
    │
    ├── integrations/         # External API clients ONLY
    │   ├── google/           # Google APIs (Gmail, Drive, Calendar, People)
    │   ├── microsoft/        # Microsoft Graph API
    │   └── qstash/           # Upstash QStash queue
    │
    ├── lib/                  # Shared server utilities
    │   ├── auth/             # Auth helpers
    │   ├── constants/        # Constants
    │   ├── llms/             # LLM provider abstraction
    │   ├── oauth/            # OAuth utilities
    │   ├── outlook/          # Outlook-specific helpers
    │   ├── parse/            # Parsing utilities (HTML, emails)
    │   ├── queue/            # Queue utilities
    │   ├── redis/            # Redis caching utilities
    │   ├── retry/            # Retry logic
    │   ├── sso/              # SSO utilities
    │   ├── upstash/          # Upstash utilities
    │   ├── user/             # User utilities
    │   ├── config.ts         # Configuration
    │   ├── date.ts           # Date utilities
    │   ├── error.ts          # Error handling
    │   ├── logger.ts         # Logging
    │   ├── mail.ts           # Email sending (Resend)
    │   ├── middleware.ts     # API middleware
    │   └── ...               # Other utilities
    │
    ├── packages/             # Internal packages (@amodel/*)
    │
    ├── scripts/              # Utility scripts (migrations, verification)
    │
    └── types/                # Shared TypeScript types
```

## Import Path Conventions

### Path Aliases (tsconfig.json)

| Alias | Points To | Usage |
|-------|-----------|-------|
| `@/*` | `./src/*` | Catch-all for src directory |
| `@/server/*` | `./src/server/*` | Server-side code |
| `@/features/*` | `./src/server/features/*` | Feature modules |
| `@/actions/*` | `./src/server/actions/*` | Server actions |
| `@/integrations/*` | `./src/server/integrations/*` | External API clients |
| `@/types/*` | `./src/server/types/*` | Shared types |
| `@/components/*` | `./src/components/*` | React components |
| `@/hooks/*` | `./src/hooks/*` | React hooks |
| `@/lib/*` | `./src/lib/*` | Frontend utilities |
| `@/generated/*` | `./generated/*` | Generated code (Prisma) |
| `@amodel/*` | `./src/server/packages/*` | Internal packages |

### Import Guidelines

1. **Feature imports**: Use `@/features/[feature-name]/...`
2. **Server utility imports**: Use `@/server/lib/...`
3. **Integration imports**: Use `@/integrations/[provider]/...`
4. **Action imports**: Use `@/actions/...`
5. **Type imports**: Use `@/types/...` or feature-local types

## Directory Purposes

### `/server/actions/`
Server actions using `next-safe-action`. Each file handles a specific domain's mutations with authentication and validation.

### `/server/features/`
Self-contained feature modules. Each feature should:
- Contain all logic for that feature
- Have an optional `ai/` subdirectory for AI-related logic
- Export a clear public API

Key features include:
- **ai/** - Core AI orchestration, agent executor, and tool definitions
- **approvals/** - Human-in-the-loop approval workflow for AI actions
- **channels/** - Multi-channel communication (Slack, Discord, Telegram, Web)
- **conversations/** - Conversation state and history management
- **privacy/** - User privacy settings and data retention
- **summaries/** - Automatic conversation summarization

### `/server/integrations/`
External API clients ONLY. No business logic here - just API wrappers:
- `google/` - Gmail, Drive, Calendar, People APIs
- `microsoft/` - Microsoft Graph API
- `qstash/` - Queue service

### `/server/lib/`
True utilities that are used across multiple features:
- Infrastructure (redis, queue, retry)
- Common helpers (parsing, dates, errors)
- Provider abstractions (llms)

### `/server/scripts/`
Utility scripts for migrations, data verification, and one-off operations. Not part of the main application runtime.

## Migration Status

| Source | Destination | Status |
|--------|-------------|--------|
| `services/unsubscriber/` | `actions/` | Completed |
| `utils/` feature modules | `features/` | Completed |
| `integrations/ai/` | `features/*/ai/` | Completed |
| `services/email/` | `features/email/` | Completed |
| `utils/` (remaining) | `lib/` | Completed |
| `agent/` | `features/surfaces/` | Completed |
| `assistant/` | `features/web-chat/` | Completed |
| `approvals/` | `features/approvals/` | Completed |
| `channels/` | `features/channels/` | Completed |
| `conversations/` | `features/conversations/` | Completed |
| `notifications/` | `features/notifications/` | Completed |
| `privacy/` | `features/privacy/` | Completed |
| `summaries/` | `features/summaries/` | Completed |

## Adding New Features

When adding a new feature:

1. Create a directory in `features/[feature-name]/`
2. Add feature logic files
3. If AI is involved, create `features/[feature-name]/ai/`
4. Add validation schemas to `actions/validation/`
5. Add server actions to `actions/[feature-name].ts`
6. Add API routes to `app/api/[feature-name]/`

## Feature Categories

### Core Infrastructure
- `email/` - Email provider abstraction
- `webhooks/` - Webhook processing
- `notifications/` - In-app notifications
- `premium/` - Subscription management

### AI Features
- `ai/` - AI orchestration and tools
- `web-chat/` - Web UI chat and email-based assistant (rule management)
- `surfaces/` - Multi-channel agent (Slack, Discord, Telegram) with approvals
- `rules/` - Automation rules with AI matching
- `clean/` - AI-powered email cleaning
- `categorize/` - AI sender categorization

### User Experience
- `channels/` - Multi-channel support
- `conversations/` - Conversation history
- `privacy/` - Privacy controls
- `summaries/` - Automatic summarization
- `approvals/` - Human-in-the-loop workflow

### Integrations
- `calendar/` - Calendar integration
- `drive/` - Drive/document integration
- `mcp/` - Model Context Protocol
- `meeting-briefs/` - Meeting briefings
