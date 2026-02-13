# AModel Architecture

This document is the source of truth for codebase organization. The app runs as a Next.js app (`src/`) plus an optional **surfaces** sidecar (`surfaces/`) for Slack/Discord/Telegram bots.

## Directory Structure

```
src/
├── app/                      # Next.js App Router (routes, API endpoints)
│   └── api/                  # API routes: chat, drafts, rules, tasks/triage,
│                             # google/calendar/watch, etc.
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
    │   ├── ai/               # Skills-first AI orchestration
    │   │   ├── skills/       # Skill contracts, router, slots, executor, telemetry
    │   │   ├── capabilities/ # Typed capability facades (email/calendar/planner)
    │   │   ├── tools/        # Provider adapters + shared time utilities
    │   │   ├── system-prompt.ts # Minimal policy/style system prompt
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
    │   ├── email/            # Core email service (providers/, threading, etc.)
    │   ├── follow-up/        # Follow-up tracking & drafts
    │   ├── groups/           # Email grouping (+ ai/)
    │   ├── knowledge/        # Knowledge base (+ ai/)
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
    │   ├── web-chat/         # Web UI chat (ai/ chat)
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
- **ai/** - Skills-first AI runtime
  - `message-processor.ts` - Conversational preflight + skills dispatch
  - `skills/` - Baseline skill contracts and deterministic execution runtime
  - `capabilities/` - Narrow typed capability layer used by skills
  - `tools/providers/` - External provider adapters used by capabilities
- **approvals/** - Human-in-the-loop workflow; **secure action tokens** for approval links (push/email)
- **channels/** - Multi-channel executor (Slack, Discord, Telegram); one-shot agent runtime
- **calendar/** - Google Calendar (events, watch, renewal cron, conflict resolution, schedule proposals)
- **tasks/** - Task triage service, context assembler, audit; panel API and approval-backed actions
- **conversations/** - Conversation state and history (RLM context)
- **memory/** - RLM memory, embeddings, rolling summaries
- **privacy/** - User privacy settings and data retention
- **summaries/** - Automatic conversation summarization
- **web-chat/** - Web UI chat assistant

### `/server/integrations/`
External API clients ONLY. No business logic here - just API wrappers:
- `google/` - Gmail, Calendar, People APIs
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
| create, modify, delete | CAUTION | Drafts, events, archive/label/trash |
| **send** | **DANGEROUS** | Send email (draft→sent); requires explicit per-email approval (in-app or verbal) |
| **rules** | CAUTION | Polymorphic: list/create/update/delete/enable/disable rules |
| **triage** | CAUTION | "What should I do next?"—rank tasks with rationale; approval-backed actions |

DANGEROUS tools are gated by the approval system; approval links use **secure signed action tokens** (`features/approvals/action-token.ts`).

### Agent Platforms

| Platform | Entry Point | Notes |
|----------|-------------|-------|
| Web Chat | `features/web-chat/ai/chat.ts` | Full tools; rule management via `rules` tool |
| Slack / Discord / Telegram | `features/channels/executor.ts` | One-shot agent; same tools; interactive draft/triage payloads |

There is **one agent** with two entry points (web chat and surfaces). Background pipelines (draft generation, calendar events, meeting briefs) run without an agent loop; when they complete, **notifications** (`features/notifications/create.ts` → `sendNotification`) generate a short message via the shared notification generator and deliver it via in-app notification and channel fallback (QStash). The user only ever talks to the single agent; the agent is the single voice of the product.

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
- `POST /api/google/calendar/watch/renew` (cron; use CRON_SECRET)

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

---

## AI Architecture: Agents, Tools, and Prompts

This section is the source of truth for how the AI layer is structured: one main conversational agent, one specialized rule-editing agent, 13 CRUD tools plus 4 memory tools, and ~50 specialist LLM calls used by tool implementations and background pipelines.

### Design Decision: No Agent-to-Agent (A2A) Protocol

The app is **one assistant with many skills**, not independent collaborating agents. We explicitly do **not** use an agent-to-agent protocol where a router delegates to sub-agents. Reasons:

- **Latency**: A2A would add 2–5 extra LLM hops per message (router → sub-agent → …).
- **Context loss**: Each sub-agent would not see full conversation history unless we serialize and pass it.
- **Cross-feature workflows**: Email + calendar + approval flows (e.g. “check my calendar and reply to John”) are natural for a single multi-step agent; splitting into sub-agents makes coordination and error handling harder.
- **Skills-first design scales**: Baseline skills route into narrow capability facades. New behavior is added as skill contracts/capability methods, not broad polymorphic tool loops.

**Chosen approach:** Single main agent runtime with conversational preflight + deterministic skills execution. Specialist LLM calls remain one-shot helpers inside bounded subsystems (not free-form tool loops).

### Agent Entry Points

| Agent | Location | Used By | Runtime |
|-------|----------|---------|---------|
| **processMessage** | `features/ai/message-processor.ts` | Web + sidecar surfaces | preflight -> skills router -> slot resolver -> executor |
| **runBaselineSkillTurn** | `features/ai/skills/runtime.ts` | Operational turns | deterministic skill execution |

Notifications: when a background pipeline completes (draft created, calendar event created, meeting briefing ready), `sendNotification()` (in `features/notifications/create.ts`) uses the shared notification generator and creates an in-app notification; channel delivery is handled by the QStash fallback.

### Skills + Capabilities

The operational assistant path is now skill-based:

- **Skills**: `features/ai/skills/baseline/*` (closed-set contracts)
- **Router**: `features/ai/skills/router/*`
- **Slot resolution**: `features/ai/skills/slots/*`
- **Executor + postconditions**: `features/ai/skills/executor/*`
- **Capability facades**: `features/ai/capabilities/*`

Mutations are only executed through allowed capability lists and postcondition checks.

### Prompt Hierarchy

1. **System prompt** (`features/ai/system-prompt.ts`): `buildAgentSystemPrompt()` — identity, safety, tool overview, behavior guidelines. Single source of truth for the main agent.
2. **Dynamic context** (`features/memory/context-manager.ts`): `ContextManager.buildContextPack()` — conversation summary, user instructions (legacy about), relevant facts, knowledge base entries, recent history. Injected per request; token budgets apply (summary ~2K, facts ~1K, knowledge ~3K, history ~5K tokens).
3. **Skill contracts and capability constraints**: Baseline skill contracts define allowed capabilities and success checks. The model does not directly execute arbitrary tools.
4. **Specialist prompts**: One-shot LLM helpers remain in feature modules; they are not a replacement for deterministic skill execution.

### Context Manager and Token Budget

`ContextManager.buildContextPack()` uses a total context budget of ~50K tokens (~200K chars). It allocates: system prompt ~3K, summary ~2K, facts ~1K, knowledge ~3K, history ~5K, with the rest reserved for response and tool use. Pending state (schedule proposals, approvals, drafts) is intended to be added here dynamically in a future phase so the agent can interpret “yes” or “the first one” without deterministic interceptors.

### Map of Specialist LLM Invocations

These are one-shot or small multi-step LLM calls used by tools or background jobs. They are **not** the main conversational agent.

| Feature | File | Function | Purpose |
|---------|------|----------|---------|
| Rules | `rules/ai/ai-choose-rule.ts` | getAiResponseSingleRule / getAiResponseMultiRule | Match incoming email to user rules |
| Rules | `rules/ai/ai-choose-args.ts` | aiChooseArgs | Extract arguments for rule actions |
| Rules | `rules/ai/prompts/prompt-to-rules.ts` | aiPromptToRules | Convert natural language to structured rules |
| Rules | `rules/ai/prompts/find-existing-rules.ts` | aiFindExistingRules | Match prompt rules to existing DB rules |
| Rules | `rules/ai/prompts/diff-rules.ts` | aiDiffRules | Diff rule changes |
| Rules | `rules/ai/prompts/generate-rules-prompt.ts` | aiGenerateRulesPrompt | Suggest rules from email behavior |
| Rules | `rules/ai/ai-detect-recurring-pattern.ts` | aiDetectRecurringPattern | Detect recurring email patterns |
| Reply tracker | `reply-tracker/ai/draft-reply.ts` | aiDraftReply | Draft email reply with knowledge |
| Reply tracker | `reply-tracker/ai/draft-follow-up.ts` | aiDraftFollowUp | Draft follow-up email |
| Reply tracker | `reply-tracker/ai/generate-nudge.ts` | aiGenerateNudge | Generate nudge text |
| Reply tracker | `reply-tracker/ai/reply-context-collector.ts` | aiCollectReplyContext | Direct email search (subject, sender, key terms); no agent |
| Reply tracker | `reply-tracker/ai/determine-thread-status.ts` | aiDetermineThreadStatus | Thread status (To Reply, FYI, etc.) |
| Reply tracker | `reply-tracker/ai/check-if-needs-reply.ts` | aiCheckIfNeedsReply | Whether email needs reply |
| Calendar | `calendar/ai/availability.ts` | aiGetCalendarAvailability | generateObject (preferences) + direct availability + slot computation |
| Meeting briefs | `meeting-briefs/ai/generate-briefing.ts` | aiGenerateMeetingBriefing | Direct web search per guest + single generateObject (briefing) |
| Knowledge | `knowledge/ai/writing-style.ts` | aiAnalyzeWritingStyle | Analyze writing style from emails |
| Knowledge | `knowledge/ai/persona.ts` | aiAnalyzePersona | Analyze professional persona |
| Knowledge | `knowledge/ai/extract-from-email-history.ts` | aiExtractFromEmailHistory | Extract context from history |
| Knowledge | `knowledge/ai/extract.ts` | aiExtractRelevantKnowledge | Extract relevant knowledge entries |
| Categorize | `categorize/ai/ai-categorize-senders.ts` | aiCategorizeSenders | Bulk categorize senders |
| Categorize | `categorize/ai/ai-categorize-single-sender.ts` | aiCategorizeSingleSender | Categorize one sender |
| Clean | `clean/ai/ai-clean.ts` | aiClean | Decide if email should be archived |
| Clean | `clean/ai/ai-clean-select-labels.ts` | aiCleanSelectLabels | Extract labels from instructions |
| Digest | `digest/ai/summarize-email-for-digest.ts` | aiSummarizeEmailForDigest | Summarize for digest |
| Cold email | `cold-email/is-cold-email.ts` | aiIsColdEmail | Detect cold email |
| Snippets | `snippets/ai/find-snippets.ts` | aiFindSnippets | Find common snippets |
| Reports | `reports/ai/*.ts` | Various | Summarize emails, build persona, analyze behavior, labels, recommendations, executive summary, response patterns |
| Tasks | `tasks/triage/TaskTriageService.ts` | triageTasks | Rank and prioritize tasks |
| Notifications | `notifications/generator.ts` | generateNotification | Generate push notification text |

The main conversational agent (`runOneShotAgent`) uses `createGenerateText` from `server/lib/llms` and receives the unified system prompt plus context pack; tool implementations may call the above specialists when needed (e.g. calendar availability, drafting, rule matching).
