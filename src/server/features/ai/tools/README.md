# Agentic Tools

Polymorphic operations that abstract actions across different resources (Email, Calendar, Automation, etc.). Uses a unified execution wrapper to enforce security policies.

## Architecture

```
tools/
├── index.ts           # Tool registry and factory (createAgentTools)
├── types.ts           # Shared types
├── security.ts        # Permission checks (SAFE/CAUTION/DANGEROUS)
├── query.ts           # Search resources
├── get.ts             # Get item details
├── modify.ts          # Change item state
├── create.ts          # Create drafts/items/events
├── delete.ts          # Remove items (email, automation)
├── analyze.ts         # AI-powered analysis
├── send.ts            # Send email (DANGEROUS; approval-gated)
├── rules.ts           # Single polymorphic rules tool
├── triage.ts          # Task triage; approval-backed actions
└── providers/
    ├── email.ts       # Email provider (Gmail/Outlook)
    ├── calendar.ts    # Calendar provider
    └── automation.ts  # Rules/Knowledge/Reports
```

## Security Tiers

| Tier | Level | Operations |
|------|-------|------------|
| SAFE | Read-only | `query`, `get`, `analyze` |
| CAUTION | Reversible / confirmations | `modify`, `create`, `delete`, `rules`, `triage` |
| DANGEROUS | Explicit approval required | `send` (email) |

## Available Tools

### `query` (SAFE)
Search for items across resources.
- **Email**: Search messages (Gmail/Outlook query syntax)
- **Calendar**: Search events by date range
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
- **Approval**: Execute decision (APPROVE/DENY)
- **Automation**: Update rules

### `create` (CAUTION)
Create new items.
- **Email**: Create **DRAFTS** only (new, reply, forward)
- **Notification**: Push notifications
- **Knowledge**: Knowledge base entries
- **Contacts**: New contacts
- **Automation**: New rules

### `delete` (CAUTION)
Remove items (soft delete where applicable).
- **Email**: Move to trash
- **Automation**: Delete rule

### `analyze` (SAFE)
AI-powered analysis.
- **Email**: Summarize, clean suggestions, categorize
- **Calendar**: Meeting briefings
- **Patterns**: Suggest automation rules

### `send` (DANGEROUS)
Send email (draft→sent). Requires explicit per-email user approval (in-app notification or verbal). Approval links use secure signed action tokens.

### `rules` (CAUTION)
Single polymorphic tool: list, create, update, delete, enable, disable rules. Supports rules portal APIs (`/api/rules`, `/api/rules/[id]`).

### `triage` (CAUTION)
Task triage: "What should I do next?"—rank tasks with rationale. Approval-backed actions; panel API: `GET /api/tasks/triage`, `POST /api/tasks/triage/action`, `GET /api/tasks/triage/audit`.

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

See `features/channels/executor.ts` and `features/web-chat/ai/chat.ts` for implementation. Approvals use secure action tokens (`features/approvals/action-token.ts`).
