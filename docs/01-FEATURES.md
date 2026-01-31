# Amodel Features List (UX Surface + Launch Prioritization)

**Legend (replaces the `#` column):**
- 🚀 = **Prioritize for launch** (ship + market)
- 🕒 = **Defer to post-launch** (ship later)
- 🗑️ = **Deprioritize / consider removal** (low leverage, confusing, or replaces with something else)

**Primary UX Surface (replaces “Do we need UI?”):**
- **UI-first** = frequent/repetitive; needs fast interaction, list views, buttons, settings
- **Chat-first** = best as an agent conversation (natural language); minimal UI scaffolding
- **Hybrid** = both; UI for browsing/confirmation, chat for intent + automation

---

## Table of Contents

1. [AI-Powered Features](#1-ai-powered-features-29-features)
2. [Agentic Capabilities](#2-agentic-capabilities-6-features)
3. [Email Provider Integration](#3-email-provider-integration-32-features)
4. [Rules & Automation Engine](#4-rules--automation-engine-12-features)
5. [Organization & User Management](#5-organization--user-management-8-features)
6. [Calendar & Drive Integration](#6-calendar--drive-integration-6-features)
7. [Analytics & Reporting](#7-analytics--reporting-5-features)
8. [Premium & Billing](#8-premium--billing-6-features)
9. [Communication & Notifications](#9-communication--notifications-4-features)
10. [Additional Features](#10-additional-features-5-features)
11. [Surfaces & Channels](#11-surfaces--channels-implemented)
12. [RLM Context & Memory](#12-rlm-context--memory-phase-5---implemented)

---

## 1. AI-Powered Features (29 features)

### User-Facing Features (21)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Agentic Supported? |
|---|---|---|---|---|---|
| 🚀 | **AI Assistant/Chat** | Interactive chat interface for email actions + refining rules | `server/integrations/ai/assistant/*` | **Chat-first** (core product) | N/A |
| 🚀 | **AI Reply Drafting** | Generate contextual replies based on thread + style | `server/integrations/ai/reply/draft-reply.ts` | **Hybrid** (chat + draft editor) | Yes (`create`) |
| 🚀 | **AI Follow-up Generation** | Draft follow-ups for threads awaiting response | `server/integrations/ai/reply/draft-follow-up.ts` | **UI-first** (queue) + Chat assist | Yes (`create`) |
| 🚀 | **AI Clean/Archive Suggestions** | Suggest safe archiving (Inbox Zero loop) | `server/integrations/ai/clean/ai-clean.ts` | **UI-first** (triage list) + Chat | Yes (`query`/`analyze`) |
| 🚀 | **AI Email Summarization** | Summaries for threads/digests | `server/integrations/ai/digest/*` | **Hybrid** (inline + chat) | Yes (`analyze`) |
| 🚀 | **AI Rule Generation** | NL → structured automation rules | `server/integrations/ai/rule/prompt-to-rules.ts` | **Hybrid** (chat → rule preview/confirm) | Yes (`create`) |
| 🕒 | **AI Rule Diffing** | Compare differences between rule versions | `server/integrations/ai/rule/diff-rules.ts` | **UI-first** (power user) | Yes (`analyze`) |
| 🕒 | **AI Sender Categorization** | Auto-categorize senders (newsletter/marketing/etc.) | `server/integrations/ai/categorize-sender/*` | **UI-first** (manage categories) | Yes (`modify`) |
| 🕒 | **AI Find Snippets** | Mine recurring canned responses from sent mail | `server/integrations/ai/snippets/find-snippets.ts` | **UI-first** (library) + Chat | Yes (`query`/`analyze`) |
| 🕒 | **AI Nudge Generation** | Generate polite nudges | `server/integrations/ai/reply/generate-nudge.ts` | **Hybrid** | Yes (`create`) |
| 🕒 | **AI Knowledge Extraction** | Extract knowledge from email history for replies | `server/integrations/ai/knowledge/*` | **Chat-first** + light “memory” UI | Yes (`analyze`) |
| 🕒 | **AI Writing Style Analysis** | Learn user style traits | `server/integrations/ai/knowledge/writing-style.ts` | **UI-first** (settings/profile) | Partial |
| 🕒 | **AI Persona Analysis** | Infer user role/industry from email | `server/integrations/ai/knowledge/persona.ts` | **UI-first** (optional) | Partial |
| 🕒 | **AI Meeting Briefings** | Context about attendees from email history | `server/integrations/ai/meeting-briefs/*` | **UI-first** (calendar context) | Yes (`analyze`) |
| 🕒 | **AI Email Reports** | Executive summaries + behavior recs | `server/integrations/ai/report/*` | **UI-first** (dashboard) | Yes (`analyze`) |
| 🕒 | **AI Label Optimization** | Suggest label cleanup/consolidation | `server/integrations/ai/report/analyze-label-optimization.ts` | **UI-first** | Yes (`analyze`) |
| 🕒 | **AI Response Patterns** | Analyze response patterns + template suggestions | `server/integrations/ai/report/response-patterns.ts` | **UI-first** | Yes (`analyze`) |
| 🕒 | **AI Document Filing** | Auto-file attachments to Drive folders | `server/integrations/ai/document-filing/*` | **UI-first** (preview/confirm) | Yes (`analyze`/`modify`) |
| 🕒 | **AI Create Group** | Create email groups from NL prompts | `server/integrations/ai/group/create-group.ts` | **Hybrid** | Yes (`create`) |
| 🗑️ | **AI Compose Autocomplete** | Real-time compose autocomplete | `src/app/api/ai/compose-autocomplete/route.ts` | **UI-first** but high-latency risk | No |
| 🕒 | **AI MCP Agent** | External tools via MCP (HubSpot/Notion/etc.) | `server/integrations/ai/mcp/*` | **UI-first** (integrations) + Chat | Partial |

### Backend-Only AI Features (8)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Notes |
|---|---|---|---|---|
| 🚀 | **AI Rule Selection** | Choose applicable rules for incoming email | `server/integrations/ai/choose-rule/ai-choose-rule.ts` | Core automation engine |
| 🕒 | **AI Pattern Detection** | Detect recurring patterns → learning rules | `server/integrations/ai/choose-rule/ai-detect-recurring-pattern.ts` | Nice-to-have learning |
| 🚀 | **AI Thread Status** | Determine TO_REPLY / FYI / etc. | `server/integrations/ai/reply/determine-thread-status.ts` | Drives triage UX |
| 🚀 | **AI Reply Context Collector** | Gather context from history for better drafts | `server/integrations/ai/reply/reply-context-collector.ts` | Draft quality |
| 🚀 | **AI Check If Needs Reply** | Decide reply tracking | `server/integrations/ai/reply/check-if-needs-reply.ts` | Follow-up loop |
| 🕒 | **AI Find Newsletters** | Identify newsletters | `server/integrations/ai/group/find-newsletters.ts` | Complement system rules |
| 🕒 | **AI Find Receipts** | Identify receipts | `server/integrations/ai/group/find-receipts.ts` | Complement system rules |
| 🚀 | **AI Prompt Security** | Prompt injection hardening | `server/integrations/ai/security.ts` | Ship early for safety |

---

## 2. Agentic Capabilities (6 features)

> These are the **agent “tools”**. They should exist at launch, but most of the time they do **not** need separate UI beyond confirmations, previews, and logs.

| 🚀/🕒/🗑️ | Tool | Description | Key Files | Security Limit | Primary UX Surface |
|---|---|---|---|---|---|
| 🚀 | **Query Tool** | Search across Email/Calendar/Automation | `server/integrations/ai/tools/query.ts` | SAFE | **Chat-first** (with results UI) |
| 🚀 | **Get Tool** | Retrieve item by ID | `server/integrations/ai/tools/get.ts` | SAFE | **Chat-first** |
| 🚀 | **Analyze Tool** | AI analysis of content | `server/integrations/ai/tools/analyze.ts` | SAFE | **Chat-first** |
| 🚀 | **Create Tool** | Create drafts (reply/forward/new) + events | `server/integrations/ai/tools/create.ts` | CAUTION | **Hybrid** (preview/confirm) |
| 🚀 | **Modify Tool** | Archive/label/mark read etc. | `server/integrations/ai/tools/modify.ts` | CAUTION | **Hybrid** (fast actions UI) |
| 🕒 | **Delete Tool** | Trash items | `server/integrations/ai/tools/delete.ts` | CAUTION | **Hybrid** (confirmations) |

---

## 3. Email Provider Integration (32 features)

### Gmail Integration (16)

**Launch stance:** If you want fastest GTM, ship **Gmail-first** and defer Microsoft until post-launch.

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Agentic Supported? |
|---|---|---|---|---|---|
| 🚀 | **Gmail OAuth Connection** | Connect Gmail via OAuth | `server/integrations/google/client.ts` | **UI-first** (settings connect) | No |
| 🚀 | **Message Retrieval** | Fetch threads/messages | `server/integrations/google/message.ts`, `thread.ts` | **UI-first** (inbox) + Chat | Yes (`query/get`) |
| 🚀 | **Draft Management** | Create/update/delete drafts | `server/integrations/google/draft.ts` | **Hybrid** | Yes (`create/delete`) |
| 🚀 | **Email Replying** | Reply to threads (draft-first) | `server/integrations/google/reply.ts` | **Hybrid** | Yes (draft via `create`) |
| 🚀 | **Email Forwarding** | Forward (draft-first) | `server/integrations/google/forward.ts` | **Hybrid** | Yes (draft via `create`) |
| 🚀 | **Label Management** | Create/apply/remove labels | `server/integrations/google/label.ts` | **UI-first** (triage) + Chat | Yes (`modify`) |
| 🚀 | **Trash Management** | Trash emails | `server/integrations/google/trash.ts` | **UI-first** + Chat | Yes (`delete`) |
| 🕒 | **Spam Management** | Mark as spam | `server/integrations/google/spam.ts` | **UI-first** | Yes (`modify`) |
| 🕒 | **Attachment Handling** | Download/process attachments | `server/integrations/google/attachment.ts` | **UI-first** | Yes (`get`) |
| 🕒 | **Contacts Search** | Search contacts | `server/integrations/google/contact.ts` | **Chat-first** + light picker | Yes (`query`) |
| 🕒 | **Signature Settings** | Manage signatures | `server/integrations/google/signature-settings.ts` | **UI-first** (settings) | No |
| 🕒 | **Email Sending** | Send emails (non-draft) | `server/integrations/google/mail.ts` | **UI-first** | No (draft only) |
| 🕒 | **Gmail Filters** | Create filters | `server/integrations/google/filter.ts` | **UI-first** (advanced) | No |
| 🚀 | **Gmail Watch/Webhooks** | Real-time sync via Pub/Sub | `server/integrations/google/watch.ts`, `watch-manager.ts` | **Backend-only** | No |
| 🚀 | **History Processing** | Incremental sync via history API | `server/integrations/google/history.ts` | **Backend-only** | No |
| 🚀 | **Batch Operations** | Efficiency batching | `server/integrations/google/batch.ts` | **Backend-only** | No |

### Outlook / Microsoft Integration (12)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Agentic Supported? |
|---|---|---|---|---|---|
| 🕒 | **Outlook OAuth Connection** | Connect Microsoft | `server/integrations/microsoft/client.ts` | UI-first | No |
| 🕒 | **Outlook Messages** | Fetch messages | `server/integrations/microsoft/message.ts` | UI-first + Chat | Yes |
| 🕒 | **Outlook Drafts** | Manage drafts | `server/integrations/microsoft/draft.ts` | Hybrid | Yes |
| 🕒 | **Outlook Replying** | Reply (draft-first) | `server/integrations/microsoft/reply.ts` | Hybrid | Yes |
| 🕒 | **Outlook Sending** | Send email | `server/integrations/microsoft/mail.ts` | UI-first | No |
| 🕒 | **Outlook Folders** | Folder management | `server/integrations/microsoft/folders.ts` | UI-first | Yes |
| 🕒 | **Outlook Attachments** | Attachment handling | `server/integrations/microsoft/attachment.ts` | UI-first | Yes |
| 🕒 | **Outlook Spam** | Mark as junk | `server/integrations/microsoft/spam.ts` | UI-first | Yes |
| 🕒 | **Outlook Trash** | Delete messages | `server/integrations/microsoft/trash.ts` | UI-first | Yes |
| 🕒 | **Outlook Calendar Client** | Calendar integration | `server/integrations/microsoft/calendar-client.ts` | UI-first | Yes |
| 🕒 | **Outlook Subscriptions** | Real-time notifications | `server/integrations/microsoft/subscription-manager.ts` | Backend-only | No |
| 🕒 | **Outlook Batch** | Batch ops | `server/integrations/microsoft/batch.ts` | Backend-only | No |

### Email Utilities (4)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface |
|---|---|---|---|---|
| 🚀 | **Email Threading** | Group into conversations | `server/services/email/threading.ts` | UI-first (inbox) |
| 🚀 | **Reply Tracking** | Track responses to sent mail | `server/utils/reply-tracker/outbound.ts` | UI-first (follow-up) |
| 🚀 | **Follow-up Reminders** | Auto-labels for unreplied threads | `server/utils/follow-up/labels.ts` | UI-first |
| 🚀 | **Bulk Operations** | Bulk archive/label | `server/services/unsubscriber/mail-bulk-action.ts` | UI-first |

---

## 4. Rules & Automation Engine (12 features)

**Launch stance:** Ship a **minimal “recipes + AI rule builder”** UI. Hide advanced knobs until later.

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Agentic Supported? |
|---|---|---|---|---|---|
| ✅ | **AI Rule Selection** | Choose applicable rules (Real Engine) | `server/integrations/ai/choose-rule/run-rules.ts` | Core automation engine |
| 🚀 | **AI Conditions** | Natural language match instructions | `Rule.instructions` | **Chat-first** + preview | Yes |
| 🕒 | **Static Conditions** | from/to/subject/body regex | Prisma `Rule` fields | UI-first (advanced) | Yes |
| 🕒 | **Group Conditions** | Sender groups/patterns | `Rule.groupId` | UI-first (advanced) | Yes |
| 🕒 | **Category Filters** | Include/exclude categories | `Rule.categoryFilters` | UI-first (advanced) | Yes |
| 🚀 | **System Rules** | Built-ins (Newsletter/Receipt/etc.) | `SystemType` enum | UI-first (toggles) | No |
| 🚀 | **Rule Actions** | Archive/label/draft/webhook/digest | `Action`, `ActionType` | UI-first + Chat confirm | Yes |
| 🕒 | **Scheduled Actions** | Delay execution | `ScheduledAction` | UI-first (later) | No |
| 🕒 | **Executed Rule Logs** | Audit executions | `ExecutedRule/Action` | UI-first (later) | No |
| 🕒 | **Rule History** | Version tracking | `RuleHistory` | UI-first (power) | Partial |
| 🕒 | **Multi-Rule Matching** | Apply multiple rules | `multiRuleSelectionEnabled` | UI-first (toggle) | No |
| 🕒 | **Rule Testing** | Test against sample messages | `server/services/unsubscriber/ai-rule.ts` | UI-first (later) | Partial |

---

## 5. Organization & User Management (8 features)

**Launch stance:** Personal-first. Keep team/enterprise features out of the launch narrative.

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface |
|---|---|---|---|---|
| 🚀 | **User Authentication** | OAuth login | `server/auth/index.ts` | UI-first |
| 🚀 | **Onboarding Flow** | Setup wizard | `server/services/unsubscriber/onboarding.ts` | UI-first |
| 🚀 | **Multi-Account Support** | Multiple email accounts | `EmailAccount` | UI-first (settings) |
| 🕒 | **API Key Management** | Keys for integrations | `server/services/unsubscriber/api-key.ts` | UI-first (security) |
| 🕒 | **Organization Management** | Teams + roles | `Organization/Member` | UI-first |
| 🕒 | **Invitation System** | Invite users | `Invitation` | UI-first |
| 🕒 | **SSO Integration** | Enterprise SSO | `SsoProvider` | UI-first |
| 🗑️ | **Referral System** | Referral tracking | `Referral` | UI-first (low GTM leverage) |

---

## 6. Calendar & Drive Integration (6 features)

**Launch stance:** Calendar/Drive are strong “v2” expansion unless calendar is your headline.

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Agentic Supported? |
|---|---|---|---|---|---|
| 🕒 | **Calendar Connection** | Connect calendars | `CalendarConnection` | UI-first | No |
| 🕒 | **Calendar Availability** | Free/busy checks | `server/integrations/ai/calendar/availability.ts` | Chat-first | Yes (`query`) |
| 🕒 | **Meeting Briefings** | Pre-meeting context | `MeetingBriefing` | UI-first | Yes |
| 🕒 | **Drive Connection** | Connect Drive/OneDrive | `DriveConnection` | UI-first | No |
| 🕒 | **Document Auto-Filing** | File attachments | `DocumentFiling` | UI-first | Yes |
| 🕒 | **Filing Folders** | Manage folder structure | `FilingFolder` | UI-first | Yes |

---

## 7. Analytics & Reporting (5 features)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface |
|---|---|---|---|---|
| 🕒 | **Email Statistics** | Usage + behavior analytics | `server/services/unsubscriber/stats.ts` | UI-first |
| 🕒 | **Response Time Tracking** | Response patterns | `ResponseTime` | UI-first |
| 🕒 | **Executive Reports** | AI summaries | `server/integrations/ai/report/` | UI-first |
| 🕒 | **Tinybird Analytics** | Data pipeline | `server/packages/tinybird/` | Backend-only |
| 🕒 | **AI Call Tracking** | AI usage tracking | `server/packages/tinybird-ai-analytics/` | Backend-only |

---

## 8. Premium & Billing (6 features)

**Launch stance:** If monetization isn’t day-1, keep billing minimal. If you are charging day-1, ship **Stripe-only** and defer Lemon.

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface |
|---|---|---|---|---|
| 🕒 | **Stripe Integration** | Subscriptions | `enterprise/stripe/` | UI-first |
| 🕒 | **Premium Tiers** | Plan levels | `PremiumTier` enum | UI-first |
| 🕒 | **Credit System** | AI/unsubscribe credits | `Premium.*Credits` | UI-first |
| 🕒 | **Payment History** | Transactions | `Payment` | UI-first |
| 🕒 | **Team Seats** | Multi-user plans | `Premium.emailAccountsAccess` | UI-first |

---

## 9. Communication & Notifications (4 features)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface |
|---|---|---|---|---|
| 🚀 | **Email Digests** | Periodic summaries of actions | `Digest*`, `server/packages/resend/` | UI-first (digest view) |
| 🕒 | **Summary Emails** | Weekly/daily summaries | `src/app/api/resend/summary/` | UI-first |
| 🕒 | **Transactional Emails** | Invites/notifications | `server/packages/resend/emails/` | Backend-only |
| 🗑️ | **Marketing Emails** | Loops integration | `server/packages/loops/` | (Not a core product feature) |

---

## 10. Additional Features (5 features)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Agentic Supported? |
|---|---|---|---|---|---|
| 🚀 | **Newsletter Unsubscribe** | One-click unsubscribe | `server/services/unsubscriber/unsubscriber.ts` | UI-first (sender page) + Chat | Yes (`modify`) |
| 🚀 | **Cleanup Jobs** | Batch archive old mail | `CleanupJob*` | UI-first (wizard) + Chat | Yes (`modify`) |
| 🚀 | **Cold Email Detection** | Detect/filter cold/sales | `Newsletter` model | UI-first + Chat | Yes |
| 🕒 | **Webhook Integration** | Custom webhooks | `Action.url`, `CALL_WEBHOOK` | UI-first (advanced) | No |
| 🕒 | **MCP Integrations** | External tool connections | `Mcp*` models | UI-first (integrations) + Chat | Yes |

---

## 11. Surfaces & Channels (Implemented)

> The "Surfaces Sidecar" enables agentic interaction across chat platforms.

### 11.1 Slack (Implemented)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| ✅ | **Slack Socket Mode** | Real-time events | Chat-first | `surfaces/` |
| ✅ | **DM Agent** | 1:1 Agent Chat | Chat-first | Core entry point |
| ✅ | **Router** | Inbound -> Agent Pipeline | Backend-only | `ChannelRouter` |

### 11.2 Discord (Implemented)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| ✅ | **Discord Gateway** | Real-time events | Chat-first | `surfaces/` |
| ✅ | **Channel/DM Chat** | Chat with Agent | Chat-first | `discord.js` |

### 11.3 Telegram (Implemented)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| ✅ | **Telegram Bot** | Long Polling | Chat-first | `surfaces/` |
| ✅ | **DM Chat** | Chat with Agent | Chat-first | `telegraf` |

### 11.4 Shared Infrastructure (Implemented)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| ✅ | **Safe Account Linking** | Magic Link Auth for Surfaces | Hybrid | `utils/linking.ts` |
| ✅ | **Unified Executor** | One-Shot Agent Runtime | Backend-only | `agent/executor.ts` |

---

## 12. RLM Context & Memory (Phase 5 - Implemented)

> The "Recursive Language Model" (RLM) context layer provides unified memory and privacy controls across all surfaces.

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Notes |
|---|---|---|---|---|---|
| ✅ | **Unified Conversation History** | Database-backed history for Slack/Discord/Web | `Conversation`, `ConversationMessage` | Backend-only | Ground truth for context |
| ✅ | **Privacy Controls** | User toggle for `recordHistory` | `PrivacySettings` | UI-first (Settings) | Prevents DB persistence |
| ✅ | **Rolling Summaries** | Background compression of long threads | `ConversationSummary`, `SummaryService` | Backend-only | Keeps context efficient |
| ✅ | **Web Chat Integration** | Persistent web chat linked to RLM | `/api/chat` | Chat-first | Parity with Slack/Discord |

---

# Launch Bundle Recommendation (what to ship + market first)

### 🚀 Launch (core loop)
- Gmail connect + inbox/thread browsing
- Summaries + draft replies + follow-up queue
- Fast actions: archive/label/trash + bulk actions
- AI clean/triage suggestions + thread status
- Rules: **recipes + AI rule generator + simple enable/disable**
- Newsletter unsubscribe + cleanup jobs
- Prompt security + audit logging (trust)

### 🕒 Post-launch (expansion)
- Outlook integration
- Calendar + meeting briefings
- Drive auto-filing
- Advanced rules (diff/history/testing/scheduling)
- Analytics dashboards + exec reports
- Stripe paywall + credits (if not needed day-1)
- MCP tools + webhooks

### 🗑️ Consider removal / hide deep in settings

- Marketing email tooling (Loops)
- Real-time compose autocomplete (unless you can guarantee UX latency + quality)
- Referral system (unless it’s a proven acquisition lever)

---

# Features That Still Need to Be Built (Calendar + Push + “True Assistant” Entry Points)

**Legend**
- 🚀 = **Build now** (needed to credibly claim “calendar + assistant” in v1)
- 🕒 = **Defer post-launch** (valuable, but not required for first calendar/assistant release)
- 🗑️ = **Deprioritize / consider removal** (complex, niche, or better later)

**Primary UX Surface**
- **UI-first** = frequent, needs fast controls (calendar views, settings, queues)
- **Chat-first** = best through agent conversation (natural language)
- **Hybrid** = both (UI for browse/confirm; chat for intent/action)

---

## 0. Scope: What’s missing vs current “Email-first” system

You already have: email tools + Gmail push/history + draft workflows + rule engine.
To become “calendar + task agent + push assistant,” you are missing:
- **Calendar provider plumbing** (read/write + sync + webhooks + incremental updates)
- **Task model + scheduling engine** (task creation, prioritization, time-blocking)
- **True assistant entry points** (Slack/Discord/Telegram + message routing + auth)
- **Push notifications** (mobile/web push + actionable approvals)
- **Agent safety/approval UX** across all surfaces (chat + push + third-party chat apps)

---

## 1. Calendar Provider Integration (Missing)

### Google Calendar (Core)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes / Why |
|---|---|---|---|---|
| 🚀 | **Google Calendar OAuth Connection** | Connect GCal with correct scopes | UI-first | Must exist to claim calendar agent |
| 🚀 | **Calendar List + Selection** | Choose which calendars to sync/use | UI-first | Users have many calendars |
| 🚀 | **Event Read APIs** | List events, get event details | Hybrid | Needed for “what’s my day” |
| 🚀 | **Free/Busy + Availability** | Accurate availability window queries | Chat-first | Needed for scheduling tasks/meetings |
| 🚀 | **Event Create (Draft-first)** | AI proposes event → user approves → create | Hybrid | “Nothing automatic” requirement |
| 🚀 | **Event Update (Draft-first)** | AI proposes edits → user approves | Hybrid | Critical for rescheduling |
| 🚀 | **Event Delete/Cancel (Draft-first)** | Propose cancellation | Hybrid | Must require explicit approval |
| 🚀 | **Calendar Watch/Webhooks** | Real-time updates via push channel | Backend-only | Equivalent of Gmail watch renewal problem |
| 🚀 | **Incremental Sync Cursor** | Store syncToken; process deltas | Backend-only | Avoid full sync; reliable performance |
| 🕒 | **Recurring Event Handling** | Exceptions, series edits | Hybrid | Complex edge cases |
| 🕒 | **Time Zone Normalization** | Multi-timezone correctness | Backend-only | Important but can tighten later |
| 🕒 | **Conference Links** | Meet/Zoom creation support | Hybrid | Adds value but non-essential |
| 🕒 | **Invitees & RSVP** | Update attendee status | UI-first | Highly sensitive; approval required |
| 🕒 | **Room/Resource Calendars** | Enterprise-ish | UI-first | Defer until teams |
| 🕒 | **Travel-time Blocks** | Auto buffer around meetings | UI-first | Nice-to-have |

### Microsoft Calendar (Post-launch)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| 🕒 | **Microsoft Calendar OAuth** | Connect Outlook calendar | UI-first | Defer if Gmail-first |
| 🕒 | **Graph Webhooks** | Subscriptions/notifications | Backend-only | Needed for parity |
| 🕒 | **Event CRUD** | Create/update/delete | Hybrid | Defer |

---

## 2. Task System (Missing)

> Right now you have “email rules + follow-ups,” but not a general-purpose task system with scheduling.

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes / Why |
|---|---|---|---|---|
| 🚀 | **Task Data Model** | Task table: title, status, due, duration, priority, tags, source links | UI-first | Foundation for everything |
| 🚀 | **Email → Task Conversion** | Turn threads into tasks w/ links & context | Hybrid | Bridges email-first → task-first |
| 🚀 | **Task List Views** | Today / Upcoming / Overdue / Project | UI-first | High-frequency daily use |
| 🚀 | **Time Blocking (Calendar Scheduling)** | Place tasks into calendar as blocks | Hybrid | Core “Motion-like” value |
| 🚀 | **Reschedule Engine** | Move task blocks when conflicts arise | Chat-first | “Agentic scheduling” core |
| 🚀 | **Task Approval Flow** | Proposed schedule changes require approve | Hybrid | Your hard requirement |
| 🚀 | **Task Templates / Quick Add** | Repeatable tasks, shortcuts | UI-first | Reduces friction |
| 🕒 | **Projects / Goals** | Group tasks beyond simple tags | UI-first | Useful but not v1 required |
| 🕒 | **Dependencies** | Task A blocks task B | UI-first | Complex; later |
| 🕒 | **Delegation / Assignments** | Multi-user tasks | UI-first | Team feature |
| 🕒 | **Task Notes & Attachments** | Rich notes, file links | UI-first | Later |
| 🗑️ | **Full Notion Replacement** | Docs/wiki baked into tasks | UI-first | Scope explosion |

---




---

## 4. Push Notifications + Actionable Approvals (Missing)

> Without push, “assistant” feels passive. Push is how you get “ClaudeBot-like” responsiveness.

### Web Push (Implemented)

| 🚀/🕒/🗑️ | Feature | Description | Key Files | Primary UX Surface | Notes |
|---|---|---|---|---|---|
| ✅ | **Web Push Setup** | Surfaces Sidecar (`/notify`) | `surfaces/` | UI-first | HTTP Server ready |
| ✅ | **Agentic Push** | AI-generated "Heads Up" notifications | `server/services/notification/generator.ts` | Backend-only | "Triple-Safe" Filtering |
| 🚀 | **Actionable Notifications** | Approve/reject proposed action | Hybrid | Requires secure action tokens |
| 🚀 | **Notification Preferences** | Quiet hours, categories, urgency | UI-first | Prevent spam |

### Mobile Push (later)

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| 🕒 | **iOS/Android Push** | APNs/FCM | UI-first | Requires app or wrapper |
| 🕒 | **Notification Actions** | Approve/edit in notification | Hybrid | Great UX, more work |

---

## 5. Core Assistant Experiences (Missing)

These are the “marketable” behaviors that make calendar/task feel agentic.

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| 🚀 | **Daily Briefing** | “Here’s today: meetings + tasks + emails” | Chat-first + UI summary | Flagship |
| 🚀 | **Schedule Something** | “Find 30 min this week for X” | Chat-first | Must propose + confirm |
| 🚀 | **Conflict Resolution** | “Meeting moved—reschedule tasks” | Chat-first | Requires calendar watches |
| 🚀 | **Meeting Prep Pack** | Agenda + attendees + context from email | Hybrid | Leverages your email advantage |
| 🚀 | **Task Triage** | “What should I do next?” with rationale | Chat-first | Needs task model |
| 🕒 | **Multi-step Plans** | “Plan my week” with iterations | Chat-first | Later polish |
| 🕒 | **Natural Language Calendar Editing** | “Move my 3pm to tomorrow” | Chat-first | Needs strong approval UI |
| 🕒 | **Follow-up Automation Across Surfaces** | follow-ups become tasks and blocks | Hybrid | Nice-to-have |

---

## 6. Agent Safety / Governance (Missing or needs expansion)

You already have prompt security. “True assistant” requires surface-level safety.

| 🚀/🕒/🗑️ | Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| 🚀 | **Unified Approval Ledger** | Every action proposal logged + who approved | UI-first | Trust building |
| 🚀 | **Action Sandbox Mode** | Draft-only by default (emails + events) | UI-first | Aligns with your requirement |
| 🚀 | **Action Scopes & Permissions** | Per-connector permissions (read-only vs write) | UI-first | Required for enterprise later too |
| 🚀 | **Rollback/Undo Where Possible** | Undo archive/label; calendar “revert proposal” | UI-first | Reduces fear |
| 🕒 | **Policy Engine for Surfaces** | Slack/Push have stricter defaults | Backend-only | Later sophistication |

---

## 7. Calendar + Task Tooling (Agent Tool Calls Missing)

Your current tool set covers Email/Calendar/Automation in concept, but calendar/task providers are incomplete.

| 🚀/🕒/🗑️ | Tooling Feature | Description | Primary UX Surface | Notes |
|---|---|---|---|---|
| 🚀 | **Calendar Provider for Query/Get** | query events, get event details | Chat-first | Must exist for agent |
| 🚀 | **Calendar Provider for Create/Modify** | create/update events (draft-first) | Hybrid | Approval required |
| 🚀 | **Task Provider for Query/Get/Create/Modify** | tasks as first-class tool resource | Chat-first + UI | Critical |
| 🕒 | **Automation Provider Enhancements** | e.g. schedule-based triggers for tasks | Hybrid | Later |

---

# Recommended “Build Now” (Launch Expansion) Bundle

### 🚀 Build now (to credibly become calendar + assistant)
1) Google Calendar OAuth + Event Read + Free/Busy
2) Event create/update (draft-first approvals)
3) Calendar push/watch + incremental sync cursor
4) Task model + task list UI + email→task conversion
5) Time-blocking tasks into calendar + reschedule engine
6) Web push notifications + actionable approvals
7) Slack DM assistant entry point + interactive approvals
8) Daily briefing + schedule-something + conflict resolution

### 🕒 Defer post-launch (growth + parity)
- Microsoft Calendar + Discord + Telegram
- Recurring events deep handling
- Meeting RSVP/attendee management
- Drive filing expansion tied to calendar
- Analytics dashboards for tasks/calendar
- Mobile push (native app)
- Advanced policy engine

### 🗑️ Deprioritize / consider removal
- Anything that expands into “full Notion/PM suite”
- Overly complex team features before you have teams
- Deep channel-based Slack workflows before DM is great



