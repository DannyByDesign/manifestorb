# Amodel Features List

> Exhaustive inventory of all features in the codebase, categorized by domain and UI requirements.

**Total Features: ~113**
- **Requires User-Facing UI: ~82 features**
- **Backend/Infrastructure Only: ~31 features**

---

## Table of Contents

1. [AI-Powered Features](#1-ai-powered-features-29-features)
2. [Agentic Capabilities](#2-agentic-capabilities-6-features)
3. [Email Provider Integration](#2-email-provider-integration-32-features)
4. [Rules & Automation Engine](#3-rules--automation-engine-12-features)
5. [Organization & User Management](#4-organization--user-management-8-features)
6. [Calendar & Drive Integration](#5-calendar--drive-integration-6-features)
7. [Analytics & Reporting](#6-analytics--reporting-5-features)
8. [Premium & Billing](#7-premium--billing-6-features)
9. [Communication & Notifications](#8-communication--notifications-4-features)
10. [Additional Features](#9-additional-features-5-features)

---

## 1. AI-Powered Features (29 features)

### Requires UI (21 features)

| # | Feature | Description | Key Files | UI Components Needed |
|---|---------|-------------|-----------|---------------------|
| 1 | **AI Rule Generation** | Convert natural language prompts into structured automation rules | `server/integrations/ai/rule/prompt-to-rules.ts` | Rule creation wizard, prompt input |
| 2 | **AI Assistant/Chat** | Interactive chat interface for refining email rules | `server/integrations/ai/assistant/chat.ts`, `process-user-request.ts` | Chat interface, message history |
| 3 | **AI Reply Drafting** | Generate contextual email replies based on thread history and user style | `server/integrations/ai/reply/draft-reply.ts` | Reply composer, draft preview |
| 4 | **AI Follow-up Generation** | Auto-generate follow-up drafts for threads awaiting response | `server/integrations/ai/reply/draft-follow-up.ts` | Follow-up queue, draft editor |
| 5 | **AI Nudge Generation** | Generate polite nudge emails for follow-ups | `server/integrations/ai/reply/generate-nudge.ts` | Nudge preview, send button |
| 6 | **AI Email Summarization** | Summarize emails for digest reports | `server/integrations/ai/digest/summarize-email-for-digest.ts` | Digest view, summary cards |
| 7 | **AI Sender Categorization** | Auto-categorize senders (Newsletter, Marketing, Support, etc.) | `server/integrations/ai/categorize-sender/ai-categorize-senders.ts` | Category management, sender list |
| 8 | **AI Knowledge Extraction** | Extract relevant knowledge from email history for replies | `server/integrations/ai/knowledge/extract.ts`, `extract-from-email-history.ts` | Knowledge base editor |
| 9 | **AI Writing Style Analysis** | Learn user's email writing style (formality, length, traits) | `server/integrations/ai/knowledge/writing-style.ts` | Style profile view, settings |
| 10 | **AI Persona Analysis** | Analyze user role, industry, position level from emails | `server/integrations/ai/knowledge/persona.ts` | Persona profile view |
| 11 | **AI Meeting Briefings** | Generate context about meeting attendees from email history | `server/integrations/ai/meeting-briefs/generate-briefing.ts` | Briefing cards, calendar view |
| 12 | **AI Email Reports** | Executive summaries, behavior analysis, recommendations | `server/integrations/ai/report/generate-executive-summary.ts`, `analyze-email-behavior.ts` | Reports dashboard |
| 13 | **AI Label Optimization** | Suggest label consolidation and cleanup | `server/integrations/ai/report/analyze-label-optimization.ts` | Label suggestions UI |
| 14 | **AI Response Patterns** | Analyze email response patterns and suggest templates | `server/integrations/ai/report/response-patterns.ts` | Pattern insights view |
| 15 | **AI Clean/Archive Suggestions** | Suggest emails that can be safely archived | `server/integrations/ai/clean/ai-clean.ts` | Cleanup wizard, suggestion list |
| 16 | **AI Compose Autocomplete** | Real-time autocomplete while composing emails | `src/app/api/ai/compose-autocomplete/route.ts` | Inline autocomplete UI |
| 17 | **AI MCP Agent** | External tool integration via Model Context Protocol (HubSpot, Notion) | `server/integrations/ai/mcp/mcp-agent.ts`, `mcp-tools.ts` | Integration settings, tool config |
| 18 | **AI Document Filing** | Analyze attachments and auto-file to appropriate Drive folders | `server/integrations/ai/document-filing/analyze-document.ts` | Filing preview, folder picker |
| 19 | **AI Find Snippets** | Find recurring canned responses from sent emails | `server/integrations/ai/snippets/find-snippets.ts` | Snippet library UI |
| 20 | **AI Create Group** | Create email groups from natural language prompts | `server/integrations/ai/group/create-group.ts` | Group creation wizard |
| 21 | **AI Rule Diffing** | Compare and show differences between rule versions | `server/integrations/ai/rule/diff-rules.ts` | Rule diff viewer |

### Backend Only (8 features)

| # | Feature | Description | Key Files |
|---|---------|-------------|-----------|
| 22 | **AI Rule Selection** | Choose which rules should apply to incoming emails | `server/integrations/ai/choose-rule/ai-choose-rule.ts` |
| 23 | **AI Pattern Detection** | Detect recurring email patterns to learn rules | `server/integrations/ai/choose-rule/ai-detect-recurring-pattern.ts` |
| 24 | **AI Thread Status** | Determine conversation status (TO_REPLY, AWAITING_REPLY, FYI, ACTIONED) | `server/integrations/ai/reply/determine-thread-status.ts` |
| 25 | **AI Reply Context Collector** | Agent that searches email history to gather context for replies | `server/integrations/ai/reply/reply-context-collector.ts` |
| 26 | **AI Check If Needs Reply** | Check if outgoing email needs reply tracking | `server/integrations/ai/reply/check-if-needs-reply.ts` |
| 27 | **AI Find Newsletters** | Identify newsletter emails automatically | `server/integrations/ai/group/find-newsletters.ts` |
| 28 | **AI Find Receipts** | Identify receipt emails automatically | `server/integrations/ai/group/find-receipts.ts` |
| 29 | **AI Prompt Security** | Validate and secure AI prompts against injection attacks | `server/integrations/ai/security.ts` |


---

## 2. Agentic Capabilities (6 features)

> **New in v0.2**: These polymorphic tools allow the AI to directly interact with backend resources (Email, Calendar) rather than just configuring rules.

| # | Tool | Description | Key Files | Security Limit |
|---|------|-------------|-----------|----------------|
| 30 | **Query Tool** | Polymorphic search across Email, Calendar, and Automation | `server/integrations/ai/tools/query.ts` | SAFE (Read-only) |
| 31 | **Get Tool** | Retrieve detailed item information by ID | `server/integrations/ai/tools/get.ts` | SAFE (Read-only) |
| 32 | **Modify Tool** | Change state (Archive, Trash, Label, Mark Read) | `server/integrations/ai/tools/modify.ts` | CAUTION |
| 33 | **Create Tool** | Create Drafts (Reply/Forward/New) and Events | `server/integrations/ai/tools/create.ts` | CAUTION (Drafts only) |
| 34 | **Delete Tool** | Soft delete items (Trash) | `server/integrations/ai/tools/delete.ts` | CAUTION |
| 35 | **Analyze Tool** | AI-powered analysis of content | `server/integrations/ai/tools/analyze.ts` | SAFE |

**Infrastructure:**
- **Providers**: `server/integrations/ai/tools/providers/` (Email, Calendar, Automation) abstract the underlying APIs.
- **Executor**: `server/integrations/ai/tools/executor.ts` handles security checks, rate limiting, and audit logging.

---

## 2. Email Provider Integration (32 features)

### Gmail Integration (16 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Gmail OAuth Connection** | Connect Gmail accounts via OAuth | `server/integrations/google/client.ts` | Yes |
| 2 | **Email Sending** | Send emails with HTML/plain text | `server/integrations/google/mail.ts` | Yes |
| 3 | **Email Replying** | Reply to email threads | `server/integrations/google/reply.ts` | Yes |
| 4 | **Email Forwarding** | Forward emails to recipients | `server/integrations/google/forward.ts` | Yes |
| 5 | **Draft Management** | Create, update, delete drafts | `server/integrations/google/draft.ts` | Yes |
| 6 | **Message Retrieval** | Fetch messages and threads | `server/integrations/google/message.ts`, `thread.ts` | Yes |
| 7 | **Label Management** | Create, apply, remove labels | `server/integrations/google/label.ts` | Yes |
| 8 | **Attachment Handling** | Download and process attachments | `server/integrations/google/attachment.ts` | Yes |
| 9 | **Gmail Filters** | Create auto-archive filters | `server/integrations/google/filter.ts` | Partial |
| 10 | **Spam Management** | Mark emails as spam | `server/integrations/google/spam.ts` | Yes |
| 11 | **Trash Management** | Delete/trash emails | `server/integrations/google/trash.ts` | Yes |
| 12 | **Signature Settings** | Manage email signatures | `server/integrations/google/signature-settings.ts` | Yes |
| 13 | **Contacts Search** | Search Google Contacts | `server/integrations/google/contact.ts` | Yes |
| 14 | **Gmail Watch/Webhooks** | Real-time email sync via Pub/Sub | `server/integrations/google/watch.ts`, `watch-manager.ts` | No |
| 15 | **History Processing** | Incremental sync via history API | `server/integrations/google/history.ts` | No |
| 16 | **Batch Operations** | Batch API calls for efficiency | `server/integrations/google/batch.ts` | No |

### Outlook/Microsoft Integration (12 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 17 | **Outlook OAuth Connection** | Connect Microsoft accounts | `server/integrations/microsoft/client.ts` | Yes |
| 18 | **Outlook Sending** | Send emails via Graph API | `server/integrations/microsoft/mail.ts` | Yes |
| 19 | **Outlook Replying** | Reply to conversations | `server/integrations/microsoft/reply.ts` | Yes |
| 20 | **Outlook Drafts** | Manage drafts | `server/integrations/microsoft/draft.ts` | Yes |
| 21 | **Outlook Messages** | Fetch messages | `server/integrations/microsoft/message.ts` | Yes |
| 22 | **Outlook Folders** | Manage folders (labels equivalent) | `server/integrations/microsoft/folders.ts`, `label.ts` | Yes |
| 23 | **Outlook Attachments** | Handle attachments | `server/integrations/microsoft/attachment.ts` | Yes |
| 24 | **Outlook Spam** | Mark as junk | `server/integrations/microsoft/spam.ts` | Yes |
| 25 | **Outlook Trash** | Delete messages | `server/integrations/microsoft/trash.ts` | Yes |
| 26 | **Outlook Subscriptions** | Real-time notifications | `server/integrations/microsoft/subscription-manager.ts` | No |
| 27 | **Outlook Batch** | Batch operations | `server/integrations/microsoft/batch.ts` | No |
| 28 | **Outlook Calendar Client** | Calendar integration | `server/integrations/microsoft/calendar-client.ts` | Yes |

### Email Utilities (4 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 29 | **Email Threading** | Group emails into conversations | `server/services/email/threading.ts` | Yes |
| 30 | **Reply Tracking** | Track sent email responses | `server/utils/reply-tracker/outbound.ts` | Yes |
| 31 | **Follow-up Reminders** | Auto-labels for unreplied emails | `server/utils/follow-up/labels.ts` | Yes |
| 32 | **Bulk Operations** | Archive/label multiple emails | `server/services/unsubscriber/mail-bulk-action.ts` | Yes |

---

## 3. Rules & Automation Engine (12 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Rule CRUD** | Create, read, update, delete rules | `server/services/unsubscriber/rule.ts` | Yes |
| 2 | **Static Conditions** | Filter by from/to/subject/body regex | Prisma `Rule` model fields | Yes |
| 3 | **AI Conditions** | Natural language instructions for matching | `Rule.instructions` field | Yes |
| 4 | **Group Conditions** | Match sender groups/patterns | `Rule.groupId`, `Group` model | Yes |
| 5 | **Category Filters** | Include/exclude sender categories | `Rule.categoryFilters` | Yes |
| 6 | **System Rules** | Built-in rules (Newsletter, Cold Email, Calendar, Receipt) | `SystemType` enum | Yes |
| 7 | **Rule Actions** | Archive, label, reply, forward, draft, webhook, digest, move | `Action` model, `ActionType` enum | Yes |
| 8 | **Scheduled Actions** | Delay action execution by minutes | `ScheduledAction` model | Yes |
| 9 | **Rule History** | Version tracking with change audit | `RuleHistory` model | Yes |
| 10 | **Executed Rule Logs** | Audit trail of rule executions | `ExecutedRule`, `ExecutedAction` models | Yes |
| 11 | **Multi-Rule Matching** | Apply multiple rules to one email | `emailAccount.multiRuleSelectionEnabled` | Partial |
| 12 | **Rule Testing** | Test rules against sample messages | `server/services/unsubscriber/ai-rule.ts` | Yes |

### Available Action Types

```
ARCHIVE          - Remove from inbox
LABEL            - Apply label/category
REPLY            - Send automatic reply
SEND_EMAIL       - Send new email
FORWARD          - Forward to recipient
DRAFT_EMAIL      - Create draft for review
MARK_SPAM        - Mark as spam
CALL_WEBHOOK     - Trigger external webhook
MARK_READ        - Mark as read
DIGEST           - Add to digest
MOVE_FOLDER      - Move to folder (Outlook)
NOTIFY_SENDER    - Send notification from Amodel
```

---

## 4. Organization & User Management (8 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **User Authentication** | OAuth login via Google/Microsoft | `server/auth/index.ts`, Better Auth | Yes |
| 2 | **Multi-Account Support** | Multiple email accounts per user | `EmailAccount` model | Yes |
| 3 | **Organization Management** | Create teams with roles | `Organization`, `Member` models | Yes |
| 4 | **Invitation System** | Invite users via email | `Invitation` model, `server/services/unsubscriber/organization.ts` | Yes |
| 5 | **SSO Integration** | Enterprise single sign-on | `SsoProvider` model, `server/services/unsubscriber/sso.ts` | Yes |
| 6 | **API Key Management** | Generate keys for integrations | `ApiKey` model, `server/services/unsubscriber/api-key.ts` | Yes |
| 7 | **Referral System** | User referral tracking and rewards | `Referral` model | Yes |
| 8 | **Onboarding Flow** | User setup wizard | `server/services/unsubscriber/onboarding.ts` | Yes |

---

## 5. Calendar & Drive Integration (6 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Calendar Connection** | Connect Google/Outlook calendars | `CalendarConnection`, `Calendar` models | Yes |
| 2 | **Calendar Availability** | Check free/busy for AI replies | `server/integrations/ai/calendar/availability.ts` | No (used in AI) |
| 3 | **Meeting Briefings** | Pre-meeting context emails | `MeetingBriefing` model, `server/services/unsubscriber/meeting-briefs.ts` | Yes |
| 4 | **Drive Connection** | Connect Google Drive/OneDrive | `DriveConnection` model | Yes |
| 5 | **Document Auto-Filing** | File attachments to Drive folders | `DocumentFiling` model, `server/services/unsubscriber/drive.ts` | Yes |
| 6 | **Filing Folders** | Manage folder structure | `FilingFolder` model | Yes |

---

## 6. Analytics & Reporting (5 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Email Statistics** | Usage and behavior analytics | `server/services/unsubscriber/stats.ts` | Yes |
| 2 | **Response Time Tracking** | Email response patterns | `ResponseTime` model | Yes |
| 3 | **Executive Reports** | AI-generated email summaries | `server/integrations/ai/report/` | Yes |
| 4 | **Tinybird Analytics** | Data pipeline for tracking | `server/packages/tinybird/` | No |
| 5 | **AI Call Tracking** | Track AI API usage | `server/packages/tinybird-ai-analytics/` | No |

---

## 7. Premium & Billing (6 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Stripe Integration** | Subscription payments | `enterprise/billing/stripe/` | Yes |
| 2 | **Lemon Squeezy Integration** | Alternative payments | `enterprise/billing/lemon/` | Yes |
| 3 | **Premium Tiers** | Multiple plan levels (Basic, Pro, Business, Copilot, Lifetime) | `PremiumTier` enum | Yes |
| 4 | **Credit System** | AI credits and unsubscribe credits | `Premium.aiCredits`, `unsubscribeCredits` | Yes |
| 5 | **Payment History** | Transaction records | `Payment` model | Yes |
| 6 | **Team Seats** | Multi-user premium plans | `Premium.emailAccountsAccess` | Yes |

### Premium Tiers

```
BASIC_MONTHLY / BASIC_ANNUALLY
PRO_MONTHLY / PRO_ANNUALLY
BUSINESS_MONTHLY / BUSINESS_ANNUALLY
BUSINESS_PLUS_MONTHLY / BUSINESS_PLUS_ANNUALLY
COPILOT_MONTHLY
LIFETIME
```

---

## 8. Communication & Notifications (4 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Email Digests** | Periodic summaries of email actions | `Digest`, `DigestItem` models, `server/packages/resend/` | Yes |
| 2 | **Summary Emails** | Weekly/daily email summaries | `src/app/api/resend/summary/` | Yes |
| 3 | **Transactional Emails** | Invitations, notifications | `server/packages/resend/emails/` | No |
| 4 | **Marketing Emails** | Via Loops integration | `server/packages/loops/` | No |

---

## 9. Additional Features (5 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Newsletter Unsubscribe** | One-click unsubscribe from senders | `server/services/unsubscriber/unsubscriber.ts`, `execute.ts` | Yes |
| 2 | **Cold Email Detection** | Identify and filter cold/sales emails | `Newsletter` model with categories | Yes |
| 3 | **Cleanup Jobs** | Batch archive old emails | `CleanupJob`, `CleanupThread` models | Yes |
| 4 | **Webhook Integration** | Custom webhook actions | `Action.url`, `CALL_WEBHOOK` action | Partial |
| 5 | **MCP Integrations** | External tool connections | `McpIntegration`, `McpConnection`, `McpTool` models | Yes |

---

## Summary by UI Requirement

### Features Requiring Full UI (82)

- All AI-powered features (except 8 backend-only)
- All email management features (compose, read, organize)
- All rules management
- All user/organization management
- All settings and configuration
- All billing and subscription management
- Digests and reports

### Features with Partial UI (3)

- Gmail Filters (admin/power user only)
- Multi-Rule Matching (toggle in settings)
- Webhook Integration (URL configuration)

### Backend-Only Features (25)

- Gmail Watch/Webhooks
- History Processing
- Batch Operations (internal)
- AI Rule Selection (automatic)
- AI Pattern Detection (background learning)
- AI Thread Status Determination
- AI Reply Context Collector
- AI Check If Needs Reply
- AI Find Newsletters
- AI Find Receipts
- AI Prompt Security
- Tinybird Analytics
- AI Call Tracking
- Transactional/Marketing emails
- OAuth callbacks
- Cron jobs for digests/summaries

---

## Database Models Reference

| Model | Purpose | UI Required |
|-------|---------|-------------|
| `User` | User accounts | Yes |
| `Account` | OAuth tokens | No |
| `Session` | User sessions | No |
| `EmailAccount` | Connected email accounts | Yes |
| `Organization` | Team workspaces | Yes |
| `Member` | Organization members | Yes |
| `Invitation` | Pending invites | Yes |
| `Rule` | Automation rules | Yes |
| `Action` | Rule actions | Yes |
| `ExecutedRule` | Rule execution logs | Yes |
| `ExecutedAction` | Action execution logs | Yes |
| `ScheduledAction` | Delayed actions | Yes |
| `Group` | Sender groups | Yes |
| `GroupItem` | Group patterns | Yes |
| `Category` | Sender categories | Yes |
| `Newsletter` | Sender tracking | Yes |
| `Label` | Gmail/Outlook labels | Yes |
| `EmailMessage` | Message metadata | Yes |
| `ThreadTracker` | Follow-up tracking | Yes |
| `Knowledge` | User knowledge base | Yes |
| `Chat` | AI chat sessions | Yes |
| `ChatMessage` | Chat messages | Yes |
| `Digest` | Email digests | Yes |
| `DigestItem` | Digest entries | Yes |
| `Premium` | Subscription status | Yes |
| `Payment` | Payment history | Yes |
| `ApiKey` | API keys | Yes |
| `CalendarConnection` | Calendar OAuth | Yes |
| `Calendar` | Synced calendars | Yes |
| `MeetingBriefing` | Meeting context | Yes |
| `DriveConnection` | Drive OAuth | Yes |
| `FilingFolder` | Filing structure | Yes |
| `DocumentFiling` | Filed documents | Yes |
| `McpIntegration` | MCP server configs | Yes |
| `McpConnection` | MCP user connections | Yes |
| `McpTool` | Available MCP tools | Yes |
| `CleanupJob` | Cleanup configurations | Yes |
| `CleanupThread` | Cleanup results | Yes |
| `ResponseTime` | Response analytics | Yes |
| `Referral` | Referral tracking | Yes |
| `RuleHistory` | Rule version history | Yes |
| `SsoProvider` | SSO configurations | Yes |
