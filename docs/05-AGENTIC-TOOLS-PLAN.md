# Agentic AI Tools Implementation Plan

> A comprehensive plan for transforming the AI assistant into a fully agentic email and calendar manager using 6 polymorphic tools.

**Status:** Implemented
**Last Updated:** January 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State](#2-current-state)
3. [Design Philosophy](#3-design-philosophy)
4. [Tool Architecture](#4-tool-architecture)
5. [Security Model](#5-security-model)
6. [Migration Plan](#6-migration-plan)
7. [Implementation Details](#7-implementation-details)
8. [UI Integration](#8-ui-integration)
9. [Future Extensibility](#9-future-extensibility)
10. [Testing Strategy](#10-testing-strategy)

---

## 1. Executive Summary

### Goal

Transform the existing "configuration-only" AI assistant into a fully agentic system that can:
- Read and search emails
- Modify email state (archive, label, trash)
- Create drafts (but never send automatically)
- Manage calendar events
- Configure automation rules
- Analyze content with AI

### Key Constraints

1. **AI must NEVER send emails** — Humans always click "Send"
2. **Minimal tool count** — 6 polymorphic tools to avoid AI performance degradation
3. **Security-first** — Tiered permissions, audit logging, scope limits
4. **Provider-agnostic** — Same tools work for Gmail and Outlook

### Tool Count Comparison

| Approach | Tools | Capability |
|----------|-------|------------|
| Current (config only) | 8 | Rules management only |
| Naive expansion | 25+ | Full capability, poor AI performance |
| **Proposed (polymorphic)** | **6** | Full capability, optimal AI performance |

---

## 2. Current State

### Existing Tools in `chat.ts`

The current AI assistant has 8 tools, all focused on configuration:

```
getUserRulesAndSettings  → Read rules and user settings
getLearnedPatterns       → Read patterns for a rule
createRule               → Create automation rule
updateRuleConditions     → Update rule conditions
updateRuleActions        → Update rule actions
updateLearnedPatterns    → Update learned patterns
updateAbout              → Update user preferences
addToKnowledgeBase       → Add to knowledge base
```

### Current Limitations

- ❌ Cannot read/search user's emails
- ❌ Cannot archive, label, or modify emails directly
- ❌ Cannot compose or draft emails
- ❌ Cannot view or manage calendar
- ❌ System prompt explicitly says: "You can't perform any actions on their inbox"

### What Works Today

When a user says "archive newsletters", the AI:
1. Creates a RULE that says "archive newsletters"
2. The rule is saved to the database
3. Later, when an email arrives via webhook, the rule is applied

This is "indirect control" — the AI configures automation, but doesn't act directly.

---

## 3. Design Philosophy

### Principle 1: Polymorphic Over Specialized

```typescript
// ❌ BAD: Tool explosion
archiveEmail, labelEmail, trashEmail, starEmail,
searchEmails, getEmail, createDraft, ...
createEvent, updateEvent, deleteEvent, ...
// = 20+ tools, AI performance degrades

// ✅ GOOD: Polymorphic tools
query({ resource: "email" | "calendar" | ... })
modify({ resource: "email" | "calendar" | ... })
create({ resource: "email" | "calendar" | ... })
// = 6 tools, covers everything
```

### Principle 2: Draft-First, Human-Send

```
AI creates draft → Returns preview + draft link → User reviews → User clicks send
```

The AI can compose perfect emails, but the "send" button stays with humans.

### Principle 3: Reversible by Default

- Archive: Reversible (can unarchive)
- Label: Reversible (can remove)
- Trash: Reversible (30-day retention)
- Permanent delete: Requires UI confirmation

### Principle 4: Provider Abstraction

Tools don't expose Gmail vs Outlook differences. The execution layer handles provider-specific APIs.

```typescript
// AI calls this (provider-agnostic):
modify({ resource: "email", ids: [...], changes: { archived: true } })

// Execution layer routes to:
// Gmail: gmail.users.messages.modify({ removeLabelIds: ['INBOX'] })
// Outlook: client.api('/messages/{id}/move').post({ destinationId: 'archive' })
```

---

## 4. Tool Architecture

### The 6 Polymorphic Tools

#### 4.1 `query` — Search and List

```typescript
const queryTool = {
  name: "query",
  description: `Search and retrieve items from any resource.
    
Resources:
- email: Search emails (supports Gmail/Outlook query syntax)
- calendar: Search events by date range, attendees, title
- drive: Search files by name, type, folder
- contacts: Search contacts by name, email, company
- automation: List rules and their configurations
- knowledge: Search knowledge base entries
- preferences: Get user preferences and settings`,
    
  parameters: z.object({
    resource: z.enum([
      "email", "calendar", "drive", "contacts",
      "automation", "knowledge", "preferences"
    ]),
    filter: z.object({
      query: z.string().optional(),      // Search query
      dateRange: z.object({
        after: z.string().optional(),    // ISO date or relative ("7d", "1w")
        before: z.string().optional(),
      }).optional(),
      limit: z.number().max(50).default(20),
    }).optional(),
  }),

  returns: `Array of items with summary fields:
    - email: { id, from, to, subject, snippet, date, labels, isRead }
    - calendar: { id, title, start, end, attendees, location }
    - automation: { id, name, enabled, conditions, actions }`,
};
```

**Example calls:**
```typescript
// Find unread emails from boss
query({ resource: "email", filter: { query: "from:boss@company.com is:unread" } })

// Get tomorrow's calendar
query({ resource: "calendar", filter: { dateRange: { after: "tomorrow", before: "tomorrow+1d" } } })

// List all automation rules
query({ resource: "automation" })
```

---

#### 4.2 `get` — Full Details

```typescript
const getTool = {
  name: "get",
  description: `Get full details of specific item(s) by ID.
    
Use after query() to retrieve complete content:
- Email: Full body, all headers, attachments list
- Calendar: Full description, all attendees, recurrence rules
- Automation: Complete rule with all conditions and actions`,
    
  parameters: z.object({
    resource: z.enum([
      "email", "calendar", "drive", "contacts",
      "automation", "knowledge"
    ]),
    ids: z.array(z.string()).max(10),
  }),

  returns: `Full item details based on resource type`,
};
```

**Example calls:**
```typescript
// Get full email content
get({ resource: "email", ids: ["msg_abc123"] })

// Get rule configuration
get({ resource: "automation", ids: ["rule_xyz789"] })
```

---

#### 4.3 `modify` — Change State

```typescript
const modifyTool = {
  name: "modify",
  description: `Modify existing items.
    
Email changes:
- archive: boolean (move to/from archive)
- trash: boolean (move to/from trash)
- read: boolean (mark read/unread)
- star: boolean (star/unstar)
- labels: { add?: string[], remove?: string[] }

Calendar changes:
- title, location, description: string
- start, end: ISO datetime
- attendees: { add?: string[], remove?: string[] }
- status: "confirmed" | "tentative" | "cancelled"

Automation changes:
- enabled: boolean
- conditions: { aiInstructions?, static?, operator? }
- actions: Action[]
- learnedPatterns: { include?, exclude? }[]

Preferences changes:
- about: string (user description for AI context)
- Any EmailAccount settings`,
    
  parameters: z.object({
    resource: z.enum([
      "email", "calendar", "drive", 
      "automation", "knowledge", "preferences"
    ]),
    ids: z.array(z.string()).max(50).optional(),
    changes: z.record(z.any()),
  }),

  securityLevel: "SAFE", // All modifications are reversible
};
```

**Example calls:**
```typescript
// Archive emails
modify({ resource: "email", ids: ["msg_1", "msg_2"], changes: { archive: true } })

// Add label
modify({ resource: "email", ids: ["msg_1"], changes: { labels: { add: ["Important"] } } })

// Update rule conditions
modify({ 
  resource: "automation", 
  ids: ["rule_xyz"], 
  changes: { 
    conditions: { aiInstructions: "Newsletters and marketing emails" } 
  } 
})

// Update user preferences
modify({ resource: "preferences", changes: { about: "I'm a software engineer..." } })
```

---

#### 4.4 `create` — Make New Items (Drafts)

```typescript
const createTool = {
  name: "create",
  description: `Create new items.
    
Email: Creates a DRAFT only. User must manually send from UI.
- type: "new" | "reply" | "forward"
- For reply/forward: provide parentId (thread ID)
- Returns: { draftId, previewUrl } for user to review and send

Calendar: Creates event (personal) or DRAFT invite (with attendees).
- Events with external attendees require user confirmation to send invites

Automation: Creates new rule (active immediately by default)

Knowledge: Adds entry to knowledge base`,
    
  parameters: z.object({
    resource: z.enum(["email", "calendar", "automation", "knowledge"]),
    type: z.enum(["new", "reply", "forward"]).optional(),
    parentId: z.string().optional(),
    data: z.object({
      // Email
      to: z.array(z.string()).optional(),
      cc: z.array(z.string()).optional(),
      subject: z.string().optional(),
      body: z.string().optional(),
      
      // Calendar
      title: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      attendees: z.array(z.string()).optional(),
      location: z.string().optional(),
      
      // Automation
      name: z.string().optional(),
      conditions: z.any().optional(),
      actions: z.array(z.any()).optional(),
      
      // Knowledge
      title: z.string().optional(),
      content: z.string().optional(),
    }),
  }),

  returns: `
    Email: { draftId, previewUrl, preview: { to, subject, bodySnippet } }
    Calendar: { eventId, previewUrl, needsConfirmation: boolean }
    Automation: { ruleId, name, enabled }
    Knowledge: { id, title }`,
};
```

**Example calls:**
```typescript
// Create reply draft
create({ 
  resource: "email", 
  type: "reply", 
  parentId: "thread_abc123",
  data: { body: "Thanks for your email! I'll review and get back to you tomorrow." }
})
// Returns: { draftId: "draft_xyz", previewUrl: "/drafts/draft_xyz", preview: {...} }

// Create calendar event
create({
  resource: "calendar",
  data: {
    title: "Team Standup",
    start: "2026-01-30T10:00:00",
    end: "2026-01-30T10:30:00",
    attendees: ["alice@company.com", "bob@company.com"]
  }
})
// Returns: { eventId: "evt_123", needsConfirmation: true } // Has external attendees

// Create automation rule
create({
  resource: "automation",
  data: {
    name: "Newsletters",
    conditions: { aiInstructions: "Newsletter and marketing emails" },
    actions: [{ type: "ARCHIVE" }, { type: "LABEL", fields: { label: "Newsletters" } }]
  }
})
```

---

#### 4.5 `delete` — Remove Items

```typescript
const deleteTool = {
  name: "delete",
  description: `Delete items.
    
Email: Moves to trash (recoverable for 30 days)
Calendar: Cancels event (notifies attendees if applicable)
Automation: Deletes rule immediately
Knowledge: Removes knowledge entry`,
    
  parameters: z.object({
    resource: z.enum(["email", "calendar", "automation", "knowledge"]),
    ids: z.array(z.string()).max(50),
  }),

  securityLevel: "CAUTION",
  
  returns: `{ success: boolean, deletedCount: number, undoAvailable: boolean }`,
};
```

**Example calls:**
```typescript
// Trash emails
delete({ resource: "email", ids: ["msg_1", "msg_2", "msg_3"] })

// Delete automation rule
delete({ resource: "automation", ids: ["rule_xyz"] })
```

---

#### 4.6 `analyze` — AI-Powered Analysis

```typescript
const analyzeTool = {
  name: "analyze",
  description: `AI-powered analysis of items. Read-only, safe operation.
    
Email analysis:
- summarize: Summarize email thread
- extract_actions: Extract action items and todos
- categorize: Categorize sender/email type

Calendar analysis:
- find_conflicts: Find scheduling conflicts
- suggest_times: Suggest available meeting times

Pattern analysis:
- detect_patterns: Analyze emails to suggest automation rules`,
    
  parameters: z.object({
    resource: z.enum(["email", "calendar", "patterns"]),
    ids: z.array(z.string()).optional(),
    analysisType: z.enum([
      "summarize", "extract_actions", "categorize",
      "find_conflicts", "suggest_times",
      "detect_patterns"
    ]),
    options: z.object({
      dateRange: z.object({
        after: z.string().optional(),
        before: z.string().optional(),
      }).optional(),
      participants: z.array(z.string()).optional(),
    }).optional(),
  }),

  securityLevel: "SAFE", // Read-only analysis
};
```

**Example calls:**
```typescript
// Summarize email thread
analyze({ resource: "email", ids: ["thread_abc"], analysisType: "summarize" })

// Find scheduling conflicts for tomorrow
analyze({ 
  resource: "calendar", 
  analysisType: "find_conflicts",
  options: { dateRange: { after: "tomorrow", before: "tomorrow+1d" } }
})

// Detect patterns for new rules
analyze({ resource: "patterns", analysisType: "detect_patterns" })
```

---

## 5. Security Model

### 5.1 Security Tiers

| Tier | Level | Confirmation | Examples |
|------|-------|--------------|----------|
| 1 | SAFE | None | `query`, `get`, `analyze` |
| 2 | CAUTION | UI toast with undo | `modify`, `delete` (trash) |
| 3 | DANGEROUS | Explicit user action | Send email (UI only, not a tool) |

### 5.2 What AI Can NEVER Do

```typescript
const FORBIDDEN_ACTIONS = [
  "sendEmail",           // User must click send
  "sendCalendarInvite",  // User must confirm
  "permanentDelete",     // User must confirm in UI
  "exportData",          // No bulk data export
  "shareExternally",     // No external sharing
];
```

### 5.3 Scope Limits

```typescript
const LIMITS = {
  maxItemsPerQuery: 50,
  maxItemsPerModify: 50,
  maxItemsPerDelete: 50,
  maxIdsPerGet: 10,
  maxBodyLength: 10000,  // Characters in email body
};
```

### 5.4 Audit Logging

Every tool call is logged:

```typescript
interface AuditLog {
  timestamp: Date;
  userId: string;
  emailAccountId: string;
  tool: string;
  resource: string;
  action: string;
  itemCount: number;
  itemIds: string[];  // First 10 only
  success: boolean;
  error?: string;
}
```

### 5.5 Rate Limiting

```typescript
const RATE_LIMITS = {
  queriesPerMinute: 30,
  modificationsPerMinute: 20,
  deletesPerMinute: 10,
  createsPerMinute: 10,
};
```

---

## 6. Migration Plan

### Phase 1: Create New Tool Infrastructure (COMPLETED)

```
src/server/features/ai/tools/
├── index.ts           # Tool registry and factory
├── types.ts           # Shared types
├── security.ts        # Permission checks, rate limiting
├── query.ts           # query tool
├── get.ts             # get tool
├── modify.ts          # modify tool
├── create.ts          # create tool
├── delete.ts          # delete tool
├── analyze.ts         # analyze tool
└── providers/
    ├── email.ts       # Email provider abstraction
    ├── calendar.ts    # Calendar provider abstraction
    ├── automation.ts  # Rules/config provider
    └── drive.ts       # Drive provider
```

### Phase 2: Implement Provider Abstraction (COMPLETED)

Provider abstraction is implemented in `src/server/features/ai/tools/providers/`

### Phase 3: Update Chat Assistant (COMPLETED)

Both agents now use `createAgentTools()` from `@/features/ai/tools` and share rule management tools via `createRuleManagementTools()` from `@/features/ai/rule-tools`.

**Agents:**
- `features/web-chat/ai/chat.ts` - Web UI chat assistant
- `features/surfaces/executor.ts` - Multi-channel agent (Slack/Discord/Telegram)

**Approval workflow:**
- `create` (drafts) - No approval required (user reviews via interactive buttons)
- `modify` and `delete` - Requires approval on web-chat; surfaces use same approval logic

**Draft Review & Send (Implemented):**
- AI creates drafts with `InteractivePayload` containing preview data
- Surfaces render rich previews (Slack Block Kit, Discord Embed, Telegram Markdown)
- Users click Send/Edit/Discard buttons to take action
- `POST /api/drafts/:id/send` handles sending (user-initiated only)

### Phase 4: Update System Prompt (COMPLETED)

**Agent Unification (Implemented):**

Both `web-chat` and `surfaces` agents now use the same system prompt from `features/ai/system-prompt.ts`:

```typescript
import { buildAgentSystemPrompt } from "@/features/ai/system-prompt";

const prompt = buildAgentSystemPrompt({
  platform: "web" | "slack" | "discord" | "telegram",
  emailSendEnabled: boolean,
});
```

This ensures consistent AI behavior, tool usage, and response style across all platforms.

```typescript
const system = `You are an AI assistant that helps manage the user's email and calendar.

You have access to 6 tools:
- query: Search emails, calendar events, automation rules, etc.
- get: Get full details of specific items
- modify: Change item state (archive, label, update)
- create: Create drafts (email), events (calendar), or rules (automation)
- delete: Remove items (moves to trash, recoverable)
- analyze: AI-powered analysis and suggestions

IMPORTANT RULES:
- You can create email drafts, but NEVER send emails. Always return the draft for user review.
- For calendar events with attendees, the user must confirm before invites are sent.
- All resources use the same tools - just specify the "resource" parameter.

Examples:
- "Archive newsletters" → query({ resource: "email", filter: { query: "category:newsletter" } }) 
                        → modify({ resource: "email", ids: [...], changes: { archive: true } })
- "What's on my calendar tomorrow?" → query({ resource: "calendar", filter: { dateRange: { after: "tomorrow" } } })
- "Reply to John saying I'll be late" → create({ resource: "email", type: "reply", parentId: "...", data: { body: "..." } })
                                      → Returns draft link for user to review and send
`;
```

### Phase 5: Deprecate Old Tools (COMPLETED)

Old tools have been migrated to `createRuleManagementTools()` which provides a shared set of rule management tools used by both agents.

---

## 7. Implementation Details

### 7.1 Tool Execution Wrapper

```typescript
// src/server/integrations/ai/tools/executor.ts

export async function executeTool(
  toolName: string,
  params: unknown,
  context: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    // 1. Validate params
    const validated = validateParams(toolName, params);
    
    // 2. Check rate limits
    await checkRateLimit(context.userId, toolName);
    
    // 3. Check permissions
    await checkPermissions(context.userId, toolName, validated);
    
    // 4. Apply scope limits
    const limited = applyScopeLimits(validated);
    
    // 5. Execute tool
    const result = await tools[toolName].execute(limited, context);
    
    // 6. Audit log
    await auditLog({
      ...context,
      tool: toolName,
      params: sanitizeForLog(limited),
      success: true,
      durationMs: Date.now() - startTime,
    });
    
    return result;
    
  } catch (error) {
    await auditLog({
      ...context,
      tool: toolName,
      params: sanitizeForLog(params),
      success: false,
      error: error.message,
      durationMs: Date.now() - startTime,
    });
    
    throw error;
  }
}
```

### 7.2 Provider Abstraction Layer

```typescript
// src/server/integrations/ai/tools/providers/email.ts

import { getGmailClientWithRefresh } from "@/server/integrations/google/client";
import { getOutlookClientWithRefresh } from "@/server/integrations/microsoft/client";
import { searchMessages as gmailSearch } from "@/server/integrations/google/message";
import { searchMessages as outlookSearch } from "@/server/integrations/microsoft/message";
// ... etc

export interface EmailProvider {
  search(query: string, limit: number): Promise<EmailSummary[]>;
  get(ids: string[]): Promise<FullEmail[]>;
  modify(ids: string[], changes: EmailChanges): Promise<ModifyResult>;
  createDraft(params: DraftParams): Promise<DraftResult>;
  trash(ids: string[]): Promise<DeleteResult>;
}

export async function createEmailProvider(
  emailAccount: EmailAccountWithAuth,
  logger: Logger
): Promise<EmailProvider> {
  if (isGoogleProvider(emailAccount.account.provider)) {
    const gmail = await getGmailClientWithRefresh({
      accessToken: emailAccount.account.access_token,
      refreshToken: emailAccount.account.refresh_token,
      expiresAt: emailAccount.account.expires_at?.getTime() ?? null,
      emailAccountId: emailAccount.id,
      logger,
    });
    
    return {
      search: (query, limit) => gmailSearch(gmail, query, limit),
      get: (ids) => gmailGetMessages(gmail, ids),
      modify: (ids, changes) => gmailModify(gmail, ids, changes),
      createDraft: (params) => gmailCreateDraft(gmail, params),
      trash: (ids) => gmailTrash(gmail, ids),
    };
  }
  
  // Outlook implementation
  const outlook = await getOutlookClientWithRefresh({ ... });
  return { ... };
}
```

---

## 8. UI Integration

### 8.1 Draft Review Flow (Implemented)

When AI creates a draft, the response includes an `InteractivePayload` with preview and actions:

```typescript
// AI returns this via create tool
{
  success: true,
  data: { draftId: "draft_abc123", ... },
  interactive: {
    type: "draft_created",
    draftId: "draft_abc123",
    emailAccountId: "...",
    userId: "...",
    summary: "Draft to john@company.com - Re: Meeting tomorrow",
    preview: {
      to: ["john@company.com"],
      subject: "Re: Meeting tomorrow",
      body: "Hi John, I'll be about 10 minutes late..."
    },
    actions: [
      { label: "Send", style: "primary", value: "send" },
      { label: "Edit in Gmail", style: "primary", value: "edit", url: "https://mail.google.com/..." },
      { label: "Discard", style: "danger", value: "discard" }
    ]
  }
}
```

**API Endpoints (Implemented):**
- `GET /api/drafts` - List all user drafts
- `GET /api/drafts/:id` - Get draft details  
- `POST /api/drafts/:id/send` - Send draft (user-initiated only)
- `DELETE /api/drafts/:id` - Discard draft

**Platform Rendering:**
- **Web App**: Pending UI (API ready)
- **Slack**: Block Kit with header, fields, body section, and action buttons
- **Discord**: Embed with fields and button row
- **Telegram**: Markdown with inline keyboard

### 8.2 Chat UI Components

```typescript
// Components needed:
// 1. DraftPreviewCard - Shows draft with Send/Edit/Discard buttons
// 2. ActionResultCard - Shows "Archived 5 emails" with Undo button
// 3. CalendarEventCard - Shows event with Confirm/Edit buttons
// 4. AnalysisResultCard - Shows AI analysis results
```

### 8.3 Confirmation Dialogs

For CAUTION tier actions, show toast with undo:

```typescript
// After modify({ archive: true })
toast({
  message: "Archived 5 emails",
  action: {
    label: "Undo",
    onClick: () => modify({ resource: "email", ids, changes: { archive: false } })
  },
  duration: 10000, // 10 seconds to undo
});
```

---

## 9. Future Extensibility

### 9.1 Adding New Resources

To add Drive support:

```typescript
// 1. Add to resource enum
resource: z.enum([..., "drive"])

// 2. Create provider
// src/server/integrations/ai/tools/providers/drive.ts
export interface DriveProvider {
  search(query: string, limit: number): Promise<FileSummary[]>;
  get(ids: string[]): Promise<FullFile[]>;
  modify(ids: string[], changes: FileChanges): Promise<ModifyResult>;
  // ... etc
}

// 3. Add cases to tool implementations
// No new tools needed!
```

### 9.2 Adding New Analysis Types

```typescript
// Just add to the enum
analysisType: z.enum([
  ...,
  "sentiment_analysis",  // New
  "priority_scoring",    // New
])

// And implement in analyze tool
```

### 9.3 Resource Roadmap

| Resource | Status | Notes |
|----------|--------|-------|
| email | **Implemented** | Gmail and Outlook |
| calendar | In Progress | Calendar integration in development |
| automation | **Implemented** | Rule management |
| knowledge | **Implemented** | Knowledge base entries |
| preferences | **Implemented** | User settings |
| drive | **Implemented** | Google Drive document filing |
| contacts | **Implemented** | Google/Outlook contacts |
| tasks | Future | Google Tasks / Microsoft To Do |

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// Test each tool independently
describe("query tool", () => {
  it("searches emails with valid query", async () => {
    const result = await queryTool.execute({
      resource: "email",
      filter: { query: "from:test@example.com" }
    }, mockContext);
    
    expect(result).toHaveLength(expect.any(Number));
    expect(result[0]).toHaveProperty("id");
  });
  
  it("respects limit parameter", async () => {
    const result = await queryTool.execute({
      resource: "email",
      filter: { query: "in:inbox", limit: 5 }
    }, mockContext);
    
    expect(result.length).toBeLessThanOrEqual(5);
  });
});
```

### 10.2 Integration Tests

```typescript
// Test tool chains
describe("email workflow", () => {
  it("can search, get details, and archive", async () => {
    // 1. Search
    const searchResult = await execute("query", {
      resource: "email",
      filter: { query: "subject:test" }
    });
    
    // 2. Get full details
    const details = await execute("get", {
      resource: "email",
      ids: [searchResult[0].id]
    });
    
    // 3. Archive
    const archiveResult = await execute("modify", {
      resource: "email",
      ids: [searchResult[0].id],
      changes: { archive: true }
    });
    
    expect(archiveResult.success).toBe(true);
  });
});
```

### 10.3 Security Tests

```typescript
describe("security", () => {
  it("enforces rate limits", async () => {
    // Make 31 queries in a minute (limit is 30)
    for (let i = 0; i < 30; i++) {
      await execute("query", { resource: "email" });
    }
    
    await expect(execute("query", { resource: "email" }))
      .rejects.toThrow("Rate limit exceeded");
  });
  
  it("enforces scope limits", async () => {
    await expect(execute("modify", {
      resource: "email",
      ids: Array(100).fill("msg_id"), // Over limit of 50
      changes: { archive: true }
    })).rejects.toThrow("Maximum 50 items per operation");
  });
  
  it("creates audit logs", async () => {
    await execute("query", { resource: "email" });
    
    const logs = await getAuditLogs({ userId: testUser.id });
    expect(logs[0]).toMatchObject({
      tool: "query",
      resource: "email",
      success: true,
    });
  });
});
```

### 10.4 AI Integration Tests

```typescript
// Test that AI uses tools correctly
describe("AI tool usage", () => {
  it("uses query and modify for archive requests", async () => {
    const response = await aiChat({
      messages: [{ role: "user", content: "Archive all newsletters" }],
      emailAccountId: testAccount.id,
    });
    
    // Check tool calls
    const toolCalls = extractToolCalls(response);
    expect(toolCalls).toContainEqual(
      expect.objectContaining({ name: "query", params: expect.objectContaining({ resource: "email" }) })
    );
    expect(toolCalls).toContainEqual(
      expect.objectContaining({ name: "modify", params: expect.objectContaining({ changes: { archive: true } }) })
    );
  });
  
  it("never calls send (because it does not exist)", async () => {
    const response = await aiChat({
      messages: [{ role: "user", content: "Send an email to John" }],
      emailAccountId: testAccount.id,
    });
    
    const toolCalls = extractToolCalls(response);
    // Should create a draft, not send
    expect(toolCalls).toContainEqual(
      expect.objectContaining({ name: "create", params: expect.objectContaining({ resource: "email" }) })
    );
    expect(toolCalls).not.toContainEqual(
      expect.objectContaining({ name: "send" })
    );
  });
});
```

---

## Appendix A: Tool Quick Reference

| Tool | Resources | Security | Description |
|------|-----------|----------|-------------|
| `query` | all | SAFE | Search and list items |
| `get` | all except preferences | SAFE | Get full item details |
| `modify` | all | CAUTION | Change item state |
| `create` | email, calendar, automation, knowledge | SAFE | Create drafts/items |
| `delete` | email, calendar, automation, knowledge | CAUTION | Remove items |
| `analyze` | email, calendar, patterns | SAFE | AI analysis |

## Appendix B: Resource Capabilities Matrix

| Capability | email | calendar | drive | automation | knowledge | preferences |
|------------|-------|----------|-------|------------|-----------|-------------|
| query | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| get | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| modify | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| create | ✅ (draft) | ✅ | ❌ | ✅ | ✅ | ❌ |
| delete | ✅ (trash) | ✅ | ❌ | ✅ | ✅ | ❌ |
| analyze | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

## Appendix C: Example Conversations

### Example 1: Archive Newsletters

```
User: Archive all newsletters from the last week

AI: [calls query({ resource: "email", filter: { query: "category:newsletters newer_than:7d" } })]
    [receives 23 emails]
    [calls modify({ resource: "email", ids: [...], changes: { archive: true } })]
    
AI: Done! I've archived 23 newsletter emails from the last week.
```

### Example 2: Draft Reply

```
User: Reply to the latest email from John saying I'll get back to him tomorrow

AI: [calls query({ resource: "email", filter: { query: "from:john@company.com", limit: 1 } })]
    [calls create({ resource: "email", type: "reply", parentId: "thread_123", data: { body: "Hi John,\n\nThanks for your email. I'll review this and get back to you tomorrow.\n\nBest regards" } })]

AI: I've drafted a reply to John. You can review it here: [Edit Draft] [Send Now] [Discard]
```

### Example 3: Calendar Check

```
User: Do I have any conflicts tomorrow afternoon?

AI: [calls query({ resource: "calendar", filter: { dateRange: { after: "tomorrow 12:00", before: "tomorrow 18:00" } } })]
    [calls analyze({ resource: "calendar", analysisType: "find_conflicts", options: { dateRange: { after: "tomorrow 12:00", before: "tomorrow 18:00" } } })]

AI: You have 3 meetings tomorrow afternoon:
- 1:00 PM - 2:00 PM: Team Standup
- 2:30 PM - 3:30 PM: Project Review
- 4:00 PM - 5:00 PM: 1:1 with Sarah

No conflicts detected. You have free time from 12:00-1:00 PM and 3:30-4:00 PM.
```
