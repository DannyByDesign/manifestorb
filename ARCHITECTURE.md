# AModel Architecture

This document is the source of truth for codebase organization. The app runs as a Next.js app (`src/`) plus an optional **surfaces** sidecar (`surfaces/`) for Slack/Discord/Telegram bots.

## Directory Structure

```
src/
├── app/                      # Next.js App Router (routes, API endpoints)
│   └── api/                  # API routes: chat, drafts, rules, tasks/triage,
│                             # google/calendar|drive/watch, etc.
├── components/               # React components (UI, experience/Orb, etc.)
├── lib/                      # Frontend utilities (stores, audio, capabilities)
├── hooks/                    # React hooks (e.g. use-notification-poll)
├── shaders/                  # WebGL/GLSL shaders (orb, particles, sim)
├── enterprise/               # Enterprise-only features (Stripe)
├── __tests__/                # Test files
└── server/                   # All backend code
    ├── actions/              # Server actions (next-safe-action handlers)
    │   └── validation/       # Zod validation schemas
    │
    ├── auth/                 # Authentication (WorkOS AuthKit)
    ├── db/                   # Database (Prisma client, extensions)
    │
    ├── features/             # Feature modules (domain logic)
    │   ├── ai/               # AI orchestration & tools
    │   │   ├── tools/        # Agent tools: query, get, analyze, create, modify,
    │   │   │                 # delete, send (DANGEROUS), rules, triage
    │   │   ├── system-prompt.ts # Unified system prompt (single source of truth)
    │   │   ├── rule-tools.ts # Web-chat rule tool wiring (rules tool in tools/rules.ts)
    │   │   ├── helpers.ts    # Shared AI helpers
    │   │   ├── security.ts   # Prompt injection protection
    │   │   └── types.ts      # AI types
    │   │
    │   ├── approvals/        # Human-in-the-loop + secure action tokens
    │   │   ├── service.ts    # Approval request management
    │   │   ├── action-token.ts # Signed tokens for approval links
    │   │   └── execute.ts    # Execute approved actions
    │   │
    │   ├── bulk-actions/     # Bulk archive/trash operations
    │   ├── calendar/         # Calendar integration (Google; watch, conflict resolution)
    │   │   └── ai/           # Availability, schedule proposals
    │   ├── categorize/       # Sender categorization (+ ai/)
    │   ├── channels/         # Multi-channel executor (Slack, Discord, Telegram)
    │   │   ├── executor.ts   # One-shot agent runtime with approvals
    │   │   ├── router.ts    # Message routing
    │   │   └── types.ts      # Channel types, InteractivePayload
    │   ├── clean/            # Email cleaning (+ ai/)
    │   ├── cold-email/       # Cold email detection & blocking
    │   ├── conversations/    # Conversation state (RLM context)
    │   ├── digest/           # Email digest (+ ai/)
    │   ├── document-filing/  # Document filing to Drive (+ ai/)
    │   ├── drive/            # Drive integration (watch, delete, filing; providers/)
    │   ├── email/            # Core email service (providers/, threading, etc.)
    │   ├── follow-up/        # Follow-up tracking & drafts
    │   ├── groups/           # Email grouping (+ ai/)
    │   ├── knowledge/        # Knowledge base (+ ai/)
    │   ├── mcp/              # Model Context Protocol (+ ai/)
    │   ├── meeting-briefs/   # Meeting briefing (+ ai/)
    │   ├── memory/           # RLM memory, embeddings, summaries
    │   ├── notifications/    # In-app notifications (create, generator)
    │   ├── organizations/   # Team/org management
    │   ├── premium/          # Premium subscription features
    │   ├── privacy/          # User privacy settings
    │   ├── referrals/        # Referral system
    │   ├── reply-tracker/    # Reply tracking & conversation status (+ ai/)
    │   ├── reports/          # Email analytics reports (+ ai/)
    │   ├── rules/            # Automation rules (+ ai/ run-rules, match, etc.)
    │   ├── scheduled/        # Scheduled actions
    │   ├── snippets/         # Email snippets (+ ai/)
    │   ├── summaries/        # Conversation summarization (SummaryService)
    │   ├── tasks/            # Task triage, scheduling, context (triage/, audit)
    │   ├── web-chat/         # Web UI chat (ai/ chat, process-user-request)
    │   └── webhooks/         # Webhook processing (Gmail/Outlook push)
    │
    ├── integrations/        # External API clients ONLY (google, microsoft, qstash)
    ├── lib/                  # Shared server utilities (auth, llms, redis, queue, etc.)
    ├── packages/            # Internal packages (@amodel/*)
    ├── scripts/             # Utility scripts
    └── types/                # Shared TypeScript types
```

**Root-level:**
- `prisma/` — Schema and migrations (`schema.prisma`, `migrations/`).
- `surfaces/` — Sidecar service for Slack/Discord/Telegram bots; uses `features/channels/executor` for the agent.
- `docs/` — Documentation (e.g. `01-FEATURES.md`).
- `ARCHITECTURE.md` — This file.

## Import Path Conventions

### Path Aliases (tsconfig.json)

| Alias | Points To | Usage |
|-------|-----------|-------|
| `@/*` | `./src/*` | Catch-all for src directory |
| `@/server/*` | `./src/server/*` | Server-side code (db, auth, etc.) |
| `@/features/*` | `./src/server/features/*` | Feature modules |
| `@/actions/*` | `./src/server/actions/*` | Server actions |
| `@/integrations/*` | `./src/server/integrations/*` | External API clients |
| `@/types/*` | `./src/server/types/*` | Shared types |
| `@/components/*` | `./src/components/*` | React components |
| `@/hooks/*` | `./src/hooks/*` | React hooks |
| `@/lib/*` | `./src/lib/*` | Frontend utilities |
| `@/generated/*` | `./generated/*` | Generated code (if used) |
| `@amodel/*` | `./src/server/packages/*` | Internal packages |

Schema and migrations live in `prisma/` (root); Prisma client is generated into `node_modules` by `prisma generate`.

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
- **ai/** - Core AI orchestration and tool definitions
  - `system-prompt.ts` - Unified system prompt (single source of truth for all agents)
  - `tools/` - Agent tools: query, get, analyze, create, modify, delete, **send** (DANGEROUS, approval-gated), **rules** (polymorphic), **triage** (task prioritization + approval-backed actions)
  - `rule-tools.ts` - Web-chat wiring for rule management (main tool in `tools/rules.ts`)
- **approvals/** - Human-in-the-loop workflow; **secure action tokens** for approval links (push/email)
- **channels/** - Multi-channel executor (Slack, Discord, Telegram); one-shot agent runtime
- **calendar/** - Google Calendar (events, watch, renewal cron, conflict resolution, schedule proposals)
- **tasks/** - Task triage service, context assembler, audit; panel API and approval-backed actions
- **drive/** - Drive providers (Google/Microsoft), watch/webhooks, renewal cron, delete file/folder (no download)
- **conversations/** - Conversation state and history (RLM context)
- **memory/** - RLM memory, embeddings, rolling summaries
- **privacy/** - User privacy settings and data retention
- **summaries/** - Automatic conversation summarization
- **web-chat/** - Web UI chat assistant

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
- `calendar/` - Google Calendar (events, watch, renewal, conflict resolution)
- `drive/` - Drive (watch, renewal, delete file/folder; document filing)
- `mcp/` - Model Context Protocol
- `meeting-briefs/` - Meeting briefings

---

## Agent Architecture

### Unified System Prompt

All AI agents (web-chat, Slack, Discord, Telegram) use the same system prompt from `features/ai/system-prompt.ts` via `buildAgentSystemPrompt()`. This ensures consistent behavior across platforms.

```typescript
import { buildAgentSystemPrompt } from "@/features/ai/system-prompt";

const prompt = buildAgentSystemPrompt({
  platform: "web" | "slack" | "discord" | "telegram",
  emailSendEnabled: boolean, // Controls draft send button visibility
});
```

### Agent Tools

| Tool | Security | Description |
|------|----------|-------------|
| query, get, analyze | SAFE | Read-only search and analysis |
| create, modify, delete | CAUTION | Drafts, events, archive/label/trash; Drive delete file/folder |
| **send** | **DANGEROUS** | Send email (draft→sent); requires explicit per-email approval (in-app or verbal) |
| **rules** | CAUTION | Polymorphic: list/create/update/delete/enable/disable rules |
| **triage** | CAUTION | "What should I do next?"—rank tasks with rationale; approval-backed actions |

DANGEROUS tools are gated by the approval system; approval links use **secure signed action tokens** (`features/approvals/action-token.ts`).

### Agent Platforms

| Platform | Entry Point | Notes |
|----------|-------------|-------|
| Web Chat | `features/web-chat/ai/` (chat, process-user-request) | Full tools; rule management via `rules` tool |
| Slack / Discord / Telegram | `features/channels/executor.ts` | One-shot agent; same tools; interactive draft/triage payloads |

The **surfaces** sidecar (`surfaces/` at repo root) runs the bot servers; they call into the Next app or use the shared executor.

### Draft Review & Send Flow

- **Drafts**: AI creates drafts; users send via explicit action (button or approval).
- **Send tool**: AI can send email only after explicit user approval (in-app notification or verbal). Implemented as a DANGEROUS tool with approval-gated execution.

```
User Request → AI creates draft → Interactive preview + Send/Edit/Discard → User clicks Send
         or → AI proposes send → Approval request (secure token) → User approves → Send
```

**API Endpoints (examples):**
- `GET /api/drafts`, `GET /api/drafts/:id`, `POST /api/drafts/:id/send`, `DELETE /api/drafts/:id`
- `GET /api/rules`, `POST /api/rules`, `GET /api/rules/:id`, `PATCH /api/rules/:id`, `DELETE /api/rules/:id`
- `GET /api/tasks/triage`, `POST /api/tasks/triage/action`, `GET /api/tasks/triage/audit`
- `POST /api/google/calendar/watch/renew`, `POST /api/google/drive/watch/renew` (cron; use CRON_SECRET)

### Surfaces Interactive Payload

When the AI creates a draft (or a triage/send approval), it can return an `InteractivePayload`:

```typescript
{
  type: "draft_created",
  draftId: "...",
  summary: "Draft to john@example.com - Subject",
  preview: { to: [...], subject: "...", body: "..." },
  actions: [
    { label: "Send", value: "send" },
    { label: "Edit in Gmail", value: "edit", url: "..." },
    { label: "Discard", value: "discard" }
  ]
}
```

Rendering:
- **Slack**: Block Kit with header, fields, body, action buttons
- **Discord**: Embed with button row
- **Telegram**: Markdown message with inline keyboard
