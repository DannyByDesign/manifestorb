# Amodel Features List

> Exhaustive inventory of all features imported from the open-source codebase, categorized by domain and UI requirements.

**Total Features: ~95**
- **Requires User-Facing UI: ~72 features**
- **Backend/Infrastructure Only: ~23 features**

---

## Table of Contents

1. [AI-Powered Features](#1-ai-powered-features-17-features)
2. [Email Provider Integration](#2-email-provider-integration-32-features)
3. [Rules & Automation Engine](#3-rules--automation-engine-12-features)
4. [Organization & User Management](#4-organization--user-management-8-features)
5. [Calendar & Drive Integration](#5-calendar--drive-integration-6-features)
6. [Analytics & Reporting](#6-analytics--reporting-5-features)
7. [Premium & Billing](#7-premium--billing-6-features)
8. [Communication & Notifications](#8-communication--notifications-4-features)
9. [Additional Features](#9-additional-features-5-features)

---

## 1. AI-Powered Features (17 features)

### Requires UI (14 features)

| # | Feature | Description | Key Files | UI Components Needed |
|---|---------|-------------|-----------|---------------------|
| 1 | **AI Rule Generation** | Convert natural language prompts into structured automation rules | `integrations/ai/rule/prompt-to-rules.ts` | Rule creation wizard, prompt input |
| 2 | **AI Assistant/Chat** | Interactive chat interface for refining email rules | `integrations/ai/assistant/chat.ts`, `process-user-request.ts` | Chat interface, message history |
| 3 | **AI Reply Drafting** | Generate contextual email replies based on thread history and user style | `integrations/ai/reply/draft-reply.ts`, `reply-context-collector.ts` | Reply composer, draft preview |
| 4 | **AI Follow-up Generation** | Auto-generate follow-up drafts for threads awaiting response | `integrations/ai/reply/draft-follow-up.ts` | Follow-up queue, draft editor |
| 5 | **AI Email Summarization** | Summarize emails for digest reports | `integrations/ai/digest/summarize-email-for-digest.ts` | Digest view, summary cards |
| 6 | **AI Sender Categorization** | Auto-categorize senders (Newsletter, Marketing, Support, etc.) | `integrations/ai/categorize-sender/ai-categorize-senders.ts` | Category management, sender list |
| 7 | **AI Knowledge Extraction** | Extract relevant knowledge from email history for replies | `integrations/ai/knowledge/extract.ts`, `extract-from-email-history.ts` | Knowledge base editor |
| 8 | **AI Writing Style Analysis** | Learn user's email writing style (formality, length, traits) | `integrations/ai/knowledge/writing-style.ts` | Style profile view, settings |
| 9 | **AI Meeting Briefings** | Generate context about meeting attendees from email history | `integrations/ai/meeting-briefs/generate-briefing.ts` | Briefing cards, calendar view |
| 10 | **AI Email Reports** | Executive summaries, behavior analysis, recommendations | `integrations/ai/report/generate-executive-summary.ts`, `analyze-email-behavior.ts` | Reports dashboard |
| 11 | **AI Clean/Archive Suggestions** | Suggest emails that can be safely archived | `integrations/ai/clean/ai-clean.ts` | Cleanup wizard, suggestion list |
| 12 | **AI Compose Autocomplete** | Real-time autocomplete while composing emails | `app/api/ai/compose-autocomplete/route.ts` | Inline autocomplete UI |
| 13 | **AI MCP Agent** | External tool integration via Model Context Protocol (HubSpot, Notion) | `integrations/ai/mcp/mcp-agent.ts`, `mcp-tools.ts` | Integration settings, tool config |
| 14 | **AI Document Filing** | Analyze attachments and auto-file to appropriate Drive folders | `integrations/ai/document-filing/analyze-document.ts` | Filing preview, folder picker |

### Backend Only (3 features)

| # | Feature | Description | Key Files |
|---|---------|-------------|-----------|
| 15 | **AI Rule Selection** | Choose which rules should apply to incoming emails | `integrations/ai/choose-rule/ai-choose-rule.ts` |
| 16 | **AI Pattern Detection** | Detect recurring email patterns to learn rules | `integrations/ai/choose-rule/ai-detect-recurring-pattern.ts` |
| 17 | **AI Prompt Security** | Validate and secure AI prompts against injection attacks | `integrations/ai/security.ts` |

---

## 2. Email Provider Integration (32 features)

### Gmail Integration (16 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Gmail OAuth Connection** | Connect Gmail accounts via OAuth | `integrations/google/client.ts` | Yes |
| 2 | **Email Sending** | Send emails with HTML/plain text | `integrations/google/mail.ts` | Yes |
| 3 | **Email Replying** | Reply to email threads | `integrations/google/reply.ts` | Yes |
| 4 | **Email Forwarding** | Forward emails to recipients | `integrations/google/forward.ts` | Yes |
| 5 | **Draft Management** | Create, update, delete drafts | `integrations/google/draft.ts` | Yes |
| 6 | **Message Retrieval** | Fetch messages and threads | `integrations/google/message.ts`, `thread.ts` | Yes |
| 7 | **Label Management** | Create, apply, remove labels | `integrations/google/label.ts` | Yes |
| 8 | **Attachment Handling** | Download and process attachments | `integrations/google/attachment.ts` | Yes |
| 9 | **Gmail Filters** | Create auto-archive filters | `integrations/google/filter.ts` | Partial |
| 10 | **Spam Management** | Mark emails as spam | `integrations/google/spam.ts` | Yes |
| 11 | **Trash Management** | Delete/trash emails | `integrations/google/trash.ts` | Yes |
| 12 | **Signature Settings** | Manage email signatures | `integrations/google/signature-settings.ts` | Yes |
| 13 | **Contacts Search** | Search Google Contacts | `integrations/google/contact.ts` | Yes |
| 14 | **Gmail Watch/Webhooks** | Real-time email sync via Pub/Sub | `integrations/google/watch.ts`, `watch-manager.ts` | No |
| 15 | **History Processing** | Incremental sync via history API | `integrations/google/history.ts` | No |
| 16 | **Batch Operations** | Batch API calls for efficiency | `integrations/google/batch.ts` | No |

### Outlook/Microsoft Integration (12 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 17 | **Outlook OAuth Connection** | Connect Microsoft accounts | `integrations/microsoft/client.ts` | Yes |
| 18 | **Outlook Sending** | Send emails via Graph API | `integrations/microsoft/mail.ts` | Yes |
| 19 | **Outlook Replying** | Reply to conversations | `integrations/microsoft/reply.ts` | Yes |
| 20 | **Outlook Drafts** | Manage drafts | `integrations/microsoft/draft.ts` | Yes |
| 21 | **Outlook Messages** | Fetch messages | `integrations/microsoft/message.ts` | Yes |
| 22 | **Outlook Folders** | Manage folders (labels equivalent) | `integrations/microsoft/folders.ts`, `label.ts` | Yes |
| 23 | **Outlook Attachments** | Handle attachments | `integrations/microsoft/attachment.ts` | Yes |
| 24 | **Outlook Spam** | Mark as junk | `integrations/microsoft/spam.ts` | Yes |
| 25 | **Outlook Trash** | Delete messages | `integrations/microsoft/trash.ts` | Yes |
| 26 | **Outlook Subscriptions** | Real-time notifications | `integrations/microsoft/subscription-manager.ts` | No |
| 27 | **Outlook Batch** | Batch operations | `integrations/microsoft/batch.ts` | No |
| 28 | **Outlook Calendar Client** | Calendar integration | `integrations/microsoft/calendar-client.ts` | Yes |

### Email Utilities (4 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 29 | **Email Threading** | Group emails into conversations | `utils/email/threading.ts` | Yes |
| 30 | **Reply Tracking** | Track sent email responses | `utils/reply-tracker/outbound.ts` | Yes |
| 31 | **Follow-up Reminders** | Auto-labels for unreplied emails | `utils/follow-up/labels.ts` | Yes |
| 32 | **Bulk Operations** | Archive/label multiple emails | `services/unsubscriber/mail-bulk-action.ts` | Yes |

---

## 3. Rules & Automation Engine (12 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Rule CRUD** | Create, read, update, delete rules | `services/unsubscriber/rule.ts` | Yes |
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
| 12 | **Rule Testing** | Test rules against sample messages | `services/unsubscriber/ai-rule.ts` | Yes |

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
| 4 | **Invitation System** | Invite users via email | `Invitation` model, `services/unsubscriber/organization.ts` | Yes |
| 5 | **SSO Integration** | Enterprise single sign-on | `SsoProvider` model, `services/unsubscriber/sso.ts` | Yes |
| 6 | **API Key Management** | Generate keys for integrations | `ApiKey` model, `services/unsubscriber/api-key.ts` | Yes |
| 7 | **Referral System** | User referral tracking and rewards | `Referral` model | Yes |
| 8 | **Onboarding Flow** | User setup wizard | `services/unsubscriber/onboarding.ts` | Yes |

---

## 5. Calendar & Drive Integration (6 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Calendar Connection** | Connect Google/Outlook calendars | `CalendarConnection`, `Calendar` models | Yes |
| 2 | **Calendar Availability** | Check free/busy for AI replies | `integrations/ai/calendar/availability.ts` | No (used in AI) |
| 3 | **Meeting Briefings** | Pre-meeting context emails | `MeetingBriefing` model, `services/unsubscriber/meeting-briefs.ts` | Yes |
| 4 | **Drive Connection** | Connect Google Drive/OneDrive | `DriveConnection` model | Yes |
| 5 | **Document Auto-Filing** | File attachments to Drive folders | `DocumentFiling` model, `services/unsubscriber/drive.ts` | Yes |
| 6 | **Filing Folders** | Manage folder structure | `FilingFolder` model | Yes |

---

## 6. Analytics & Reporting (5 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Email Statistics** | Usage and behavior analytics | `services/unsubscriber/stats.ts` | Yes |
| 2 | **Response Time Tracking** | Email response patterns | `ResponseTime` model | Yes |
| 3 | **Executive Reports** | AI-generated email summaries | `integrations/ai/report/` | Yes |
| 4 | **Tinybird Analytics** | Data pipeline for tracking | `packages/tinybird/` | No |
| 5 | **AI Call Tracking** | Track AI API usage | `packages/tinybird-ai-analytics/` | No |

---

## 7. Premium & Billing (6 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Stripe Integration** | Subscription payments | `ee/billing/stripe/` | Yes |
| 2 | **Lemon Squeezy Integration** | Alternative payments | `ee/billing/lemon/` | Yes |
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
| 1 | **Email Digests** | Periodic summaries of email actions | `Digest`, `DigestItem` models, `packages/resend/` | Yes |
| 2 | **Summary Emails** | Weekly/daily email summaries | `app/api/resend/summary/` | Yes |
| 3 | **Transactional Emails** | Invitations, notifications | `packages/resend/emails/` | No |
| 4 | **Marketing Emails** | Via Loops integration | `packages/loops/` | No |

---

## 9. Additional Features (5 features)

| # | Feature | Description | Key Files | Needs UI |
|---|---------|-------------|-----------|----------|
| 1 | **Newsletter Unsubscribe** | One-click unsubscribe from senders | `services/unsubscriber/unsubscriber.ts`, `execute.ts` | Yes |
| 2 | **Cold Email Detection** | Identify and filter cold/sales emails | `Newsletter` model with categories | Yes |
| 3 | **Cleanup Jobs** | Batch archive old emails | `CleanupJob`, `CleanupThread` models | Yes |
| 4 | **Webhook Integration** | Custom webhook actions | `Action.url`, `CALL_WEBHOOK` action | Partial |
| 5 | **MCP Integrations** | External tool connections | `McpIntegration`, `McpConnection`, `McpTool` models | Yes |

---

## Summary by UI Requirement

### Features Requiring Full UI (72)

- All AI-powered features (except 3 backend-only)
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

### Backend-Only Features (23)

- Gmail Watch/Webhooks
- History Processing
- Batch Operations (internal)
- AI Rule Selection (automatic)
- AI Pattern Detection (background learning)
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
