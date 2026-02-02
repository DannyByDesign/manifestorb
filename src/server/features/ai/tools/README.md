# Agentic Tools

Polymorphic operations that abstract actions across different resources (Email, Calendar, Automation, etc.). Uses a unified execution wrapper to enforce security policies.

## Architecture

```
tools/
├── index.ts           # Tool registry and factory (createAgentTools)
├── types.ts           # Shared types
├── security.ts        # Permission checks
├── query.ts           # Search resources
├── get.ts             # Get item details
├── modify.ts          # Change item state
├── create.ts          # Create drafts/items
├── delete.ts          # Remove items
├── analyze.ts         # AI-powered analysis
└── providers/
    ├── email.ts       # Email provider (Gmail/Outlook)
    ├── calendar.ts    # Calendar provider
    ├── drive.ts       # Drive provider
    └── automation.ts  # Rules/Knowledge/Reports
```

## Security Tiers

| Tier | Level | Operations |
|------|-------|------------|
| SAFE | Read-only | `query`, `get`, `analyze` |
| CAUTION | Reversible | `modify`, `create`, `delete` |

## Available Tools

### `query` (SAFE)
Search for items across resources.
- **Email**: Search messages (Gmail/Outlook query syntax)
- **Calendar**: Search events by date range
- **Drive**: Natural language search
- **Contacts**: Search people
- **Automation**: List rules
- **Patterns**: Detected email patterns
- **Approval**: Pending approvals

### `get` (SAFE)
Retrieve full details by ID.
- **Email**: Full message content
- **Approval**: Approval request details

### `modify` (CAUTION)
Change item state.
- **Email**: archive, trash, read, labels, unsubscribe, tracking
- **Drive**: Move files
- **Approval**: Execute decision (APPROVE/DENY)
- **Automation**: Update rules

### `create` (CAUTION)
Create new items.
- **Email**: Create **DRAFTS** only (new, reply, forward)
- **Drive**: Create folders, file attachments
- **Notification**: Push notifications
- **Knowledge**: Knowledge base entries
- **Contacts**: New contacts
- **Automation**: New rules

### `delete` (CAUTION)
Remove items (soft delete).
- **Email**: Move to trash
- **Automation**: Delete rule

### `analyze` (SAFE)
AI-powered analysis.
- **Email**: Summarize, clean suggestions, categorize
- **Calendar**: Meeting briefings
- **Patterns**: Suggest automation rules

## Usage

```typescript
import { createAgentTools } from "@/features/ai/tools";

const tools = await createAgentTools({
  email: emailAccount.email,
  emailAccountId: emailAccount.id,
  provider,
  userId,
  logger,
});
```

## Approval Workflow

Sensitive operations (`modify`, `delete`) can be wrapped with approval:

```typescript
import { ApprovalService } from "@/features/approvals/service";

const approvalService = new ApprovalService(prisma);
// Wrap tools with approval flow in executor/chat
```

See `features/surfaces/executor.ts` and `features/web-chat/ai/chat.ts` for implementation.
