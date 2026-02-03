# AI Integration Module

This module houses the core logic for the AI Agent, including tool definitions, rule management, system prompts, and model configuration.

## Directory Structure

```
ai/
├── tools/              # Polymorphic agentic tools
│   ├── index.ts        # Tool registry and factory
│   ├── query.ts        # Search across resources
│   ├── get.ts          # Retrieve item details
│   ├── create.ts       # Create drafts/items
│   ├── modify.ts       # Modify item state
│   ├── delete.ts       # Remove items
│   ├── analyze.ts      # AI-powered analysis
│   ├── types.ts        # Tool type definitions
│   ├── security.ts     # Permission checks
│   └── providers/      # Resource providers
│       ├── email.ts    # Email provider
│       ├── calendar.ts # Calendar provider
│       ├── drive.ts    # Drive provider
│       └── automation.ts # Rules provider
├── system-prompt.ts    # Unified system prompt (single source of truth)
├── rule-tools.ts       # Shared rule management tools
├── memory-tools.ts     # Memory management tools (remember/recall/forget)
├── helpers.ts          # Shared AI helpers
├── security.ts         # Prompt injection protection
├── actions.ts          # AI action types
└── types.ts            # AI types
```

## 1. The Polymorphic Toolset (`tools/`)

We use a standardized set of 6 "Polymorphic" tools to interact with all backend resources.

| Tool | Purpose | Key Resources |
|------|---------|---------------|
| `query` | Search and list items | `email`, `calendar`, `automation`, `patterns`, `approval`, `drive`, `contacts` |
| `get` | Retrieve item details | `email`, `approval` |
| `create` | Create new items (Drafts) | `email`, `automation`, `knowledge`, `drive`, `notification`, `contacts` |
| `modify` | Update item state | `email` (archive/label/track), `automation`, `approval` |
| `delete` | Remove items | `email`, `automation` |
| `analyze` | AI analysis/extraction | `email` (clean/categorize), `calendar` (briefing), `patterns` |

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

## 3. Rule Management Tools (`rule-tools.ts`)

Shared tools for rule configuration, used by both `web-chat` and `surfaces` agents:

| Tool | Purpose |
|------|---------|
| `getUserRulesAndSettings` | Retrieve all rules and user settings |
| `getLearnedPatterns` | Get patterns for a rule |
| `createRule` | Create automation rule |
| `updateRuleConditions` | Update rule conditions |
| `updateRuleActions` | Update rule actions |
| `updateLearnedPatterns` | Update learned patterns |
| `updateAbout` | Update user preferences |
| `addToKnowledgeBase` | Add to knowledge base |

## 4. Providers (`tools/providers/`)

Tools delegate execution to providers for resource-specific implementations:
- `automation.ts` - Rules, Knowledge, Unsubscriber, Reports
- `email.ts` - Email provider abstraction
- `calendar.ts` - Calendar provider abstraction
- `drive.ts` - Drive provider abstraction

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

**Security:** AI can NEVER send emails directly. The send endpoint requires:
1. Valid user session OR surfaces shared secret
2. User-initiated request (button click)
3. Draft ownership verification

## Related Modules

- **`features/web-chat/`** - Web UI chat assistant using these tools
- **`features/surfaces/`** - Multi-channel agent (Slack/Discord/Telegram)
- **`features/channels/`** - Channel router and types (InteractivePayload)
- **`features/rules/ai/`** - Rule matching and execution AI
- **`features/memory/`** - Unified memory system (recording, embeddings, decay)
- **`features/memory/`** - Memory decay and lifecycle management
- **`app/api/drafts/`** - Draft management API endpoints
- **`app/api/jobs/record-memory/`** - Memory recording job endpoint

## Documentation

- [Memory Architecture](../memory/ARCHITECTURE.md) - Full memory system overview
- [LLM Registry](../../../../docs/LLM_REGISTRY.md) - Model configuration