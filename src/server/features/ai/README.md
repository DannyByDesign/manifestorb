# AI Integration Module

This module houses the core logic for the AI Agent, including tool definitions, rule management, system prompts, and model configuration.

## Directory Structure

```
ai/
├── tools/              # Agentic tools
│   ├── index.ts        # Tool registry and factory (createAgentTools)
│   ├── query.ts        # Search across resources
│   ├── get.ts          # Retrieve item details
│   ├── create.ts       # Create drafts/items/events
│   ├── modify.ts       # Modify item state
│   ├── delete.ts       # Remove items (email, automation)
│   ├── analyze.ts      # AI-powered analysis
│   ├── send.ts         # Send email (DANGEROUS; approval-gated)
│   ├── rules.ts        # Single polymorphic rules tool (list/create/update/delete/enable/disable)
│   ├── triage.ts       # Task triage ("what should I do next?"; approval-backed actions)
│   ├── types.ts        # Tool type definitions
│   ├── security.ts     # Permission checks (SAFE/CAUTION/DANGEROUS)
│   └── providers/      # Resource providers (email, calendar, automation)
├── system-prompt.ts    # Unified system prompt (single source of truth)
├── rule-tools.ts       # Web-chat wiring for rule management (main tool: tools/rules.ts)
├── memory-tools.ts     # Memory management tools (remember/recall/forget)
├── helpers.ts          # Shared AI helpers
├── security.ts         # Prompt injection protection
├── actions.ts          # AI action types
└── types.ts            # AI types
```

## 1. The Agent Toolset (`tools/`)

We use a set of agent tools to interact with backend resources. **DANGEROUS** tools (e.g. `send`) require explicit per-action approval (secure action tokens).

| Tool | Security | Purpose | Key Resources |
|------|----------|---------|---------------|
| `query` | SAFE | Search and list items | `email`, `calendar`, `automation`, `patterns`, `approval`, `contacts` |
| `get` | SAFE | Retrieve item details | `email`, `approval` |
| `create` | CAUTION | Create drafts/items/events | `email`, `automation`, `knowledge`, `notification`, `contacts` |
| `modify` | CAUTION | Update item state | `email`, `automation`, `approval` |
| `delete` | CAUTION | Remove items | `email`, `automation` |
| `analyze` | SAFE | AI analysis/extraction | `email` (clean/categorize), `calendar` (briefing), `patterns` |
| `send` | **DANGEROUS** | Send email (draft→sent) | Requires explicit user approval (in-app or verbal) |
| `rules` | CAUTION | Rule management (polymorphic) | List/create/update/delete/enable/disable rules |
| `triage` | CAUTION | Task prioritization | Rank tasks with rationale; approval-backed actions; panel API |

## 2. Memory Tools (`memory-tools.ts`)

Tools for persistent memory management, enabling the AI to remember facts across conversations:

| Tool | Purpose |
|------|---------|
| `rememberFact` | Store a fact about the user (key-value with confidence) |
| `recallFacts` | Retrieve facts by key or semantic search |
| `forgetFact` | Delete a specific fact |

**Usage:**
```typescript
import { createMemoryTools } from "@/features/ai/memory-tools";

const memoryTools = createMemoryTools({
  userId: user.id,
  email: user.email,
  logger,
});
```

**Features:**
- Key normalization (snake_case, lowercase)
- Quality validation (no sensitive data, min confidence)
- Semantic deduplication via embeddings
- PostHog analytics tracking

See `docs/CONTEXT-MEMORY-ARCHITECTURE.md` for full memory system documentation.

## 3. Rule Management (`rules` tool + `rule-tools.ts`)

Rule management is exposed as a **single polymorphic `rules` tool** in `tools/rules.ts` (list/create/update/delete/enable/disable). The same behavior is available on web-chat and surfaces. `rule-tools.ts` wires the rules tool for the web-chat agent. Rules portal APIs: `GET/POST /api/rules`, `GET/PATCH/DELETE /api/rules/[id]`.

## 4. Providers (`tools/providers/`)

Tools delegate execution to providers for resource-specific implementations:
- `automation.ts` - Rules, Knowledge, Unsubscriber, Reports
- `email.ts` - Email provider abstraction
- `calendar.ts` - Calendar provider abstraction

## 5. Security (`security.ts`)

Prompt injection protection and security guardrails:
- Input sanitization
- Content filtering
- Injection detection

## 6. Unified System Prompt (`system-prompt.ts`)

Both agents (web-chat and surfaces) use the same system prompt built by `buildAgentSystemPrompt()`:

```typescript
import { buildAgentSystemPrompt } from "@/features/ai/system-prompt";

const prompt = buildAgentSystemPrompt({
  platform: "web" | "slack" | "discord" | "telegram",
  emailSendEnabled: boolean,
});
```

**Prompt includes:**
- Tool documentation (agentic + rule management)
- "Second Brain" principle (check rules before acting)
- Security & safety guidelines
- Injection defense instructions
- Deep mode strategy (recursive tool usage)
- Rule structure and best practices
- Feature explanations (Reply Zero, patterns, knowledge base)
- Examples for rule creation

## 7. Draft Review & Send Flow

When AI creates a draft via the `create` tool, it returns an `InteractivePayload` with preview data:

```typescript
// Defined in tools/types.ts
interface DraftPreview {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
}

interface InteractivePayload {
  type: "draft_created";
  draftId: string;
  preview: DraftPreview;
  actions: InteractiveAction[];
}
```

**API Endpoints** (in `app/api/drafts/`):
- `GET /api/drafts` - List all user drafts
- `GET /api/drafts/:id` - Get draft details
- `POST /api/drafts/:id/send` - Send draft (user-initiated)
- `DELETE /api/drafts/:id` - Discard draft

**Security:** Sending email is gated. Two paths:
1. **Draft flow**: User clicks Send on a draft (draft endpoint requires session or surfaces secret + ownership).
2. **Send tool**: The `send` tool (DANGEROUS) can send only after explicit user approval (in-app notification or verbal). Approval links use **secure signed action tokens** (`features/approvals/action-token.ts`).

## 8. Action Requests (Calendar/Task)

Calendar/task changes that require approval emit an `InteractivePayload` of type `action_request`.
These are generated in `features/channels/router.ts` from approval requests and rendered in sidecar UIs.

```typescript
interface ActionRequestContext {
  resource: "calendar" | "task";
  action: "create" | "modify" | "delete" | "reschedule";
  title?: string;
  timeRange?: string;
}

interface InteractivePayload {
  type: "action_request";
  approvalId: string;
  summary: string; // Conversational copy for sidecar
  actions: InteractiveAction[]; // Approve/Deny buttons
  context?: ActionRequestContext;
}
```

## Related Modules

- **`features/web-chat/`** - Web UI chat assistant using these tools
- **`features/channels/`** - Multi-channel executor (Slack/Discord/Telegram) and types (InteractivePayload)
- **`features/approvals/`** - Human-in-the-loop and secure action tokens for approval links
- **`features/rules/ai/`** - Rule matching and execution AI
- **`features/tasks/`** - Task triage service and panel API (`/api/tasks/triage`, `/api/tasks/triage/action`, `/api/tasks/triage/audit`)
- **`features/memory/`** - Unified memory system (recording, embeddings, decay)
- **`app/api/drafts/`** - Draft management API endpoints
- **`app/api/rules/`** - Rules portal API
- **`app/api/jobs/record-memory/`** - Memory recording job endpoint (if present)

## Documentation

- [Memory Architecture](../memory/ARCHITECTURE.md) - Full memory system overview
- [Features List](../../../../docs/01-FEATURES.md) - Feature list and launch prioritization
- Root [ARCHITECTURE.md](../../../../ARCHITECTURE.md) - Codebase architecture
