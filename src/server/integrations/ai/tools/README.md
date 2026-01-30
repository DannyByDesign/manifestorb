
# Agentic Tools

Agentic tools are a set of polymorphic operations that abstract actions across different resources (Email, Calendar, Automation, etc.). They use a unified execution wrapper (`executor`) to enforce security policies and log audits.

## Architecture

1.  **Providers**: Abstracted interfaces (Email, Calendar, Automation) that handle the actual API calls (e.g., Gmail vs Outlook).
2.  **Tools**: 6 polymorphic operations (query, get, modify, create, delete, analyze) defined using a unified `ToolDefinition` type.
3.  **Executor**: `executor.ts` wraps all tool executions, handling permissions, rate limiting, and audit logging.
4.  **Security**:
    *   **SAFE**: Read-only operations (`query`, `get`).
    *   **CAUTION**: Modifications that are typically reversible (`modify`, `create`, `delete` - soft delete).
    *   **DANGEROUS**: Destructive or external actions (`sendEmail` - currently disabled mostly).

## Available Tools

### `query` (SAFE)
Search for items across different resources.
*   **Email**: Search messages (supports Gmail/Outlook query syntax).
*   **Calendar**: Search events by date range, attendees, title.
*   **Automation**: List rules.

### `get` (SAFE)
Retrieve full details of specific items by ID.
*   **Email**: Get full message content (HTML/Text).
*   **Calendar**: Get event details.
*   **Automation**: Get rule details.

### `modify` (CAUTION)
Modify the state of existing items.
*   **Email**:
    *   `archive`: boolean (move to/from archive).
    *   `trash`: boolean (move to/from trash).
    *   `read`: boolean (mark read/unread).
    *   `labels`: Add/remove labels.
*   **Calendar**: Change event details (not yet implemented).

### `create` (CAUTION)
Create new items.
*   **Email**: Create **DRAFTS** (new, reply, forward). Users must manually send from the UI.
*   **Calendar**: Create events (not yet implemented).
*   **Automation**: Create rules (not yet implemented).

### `delete` (CAUTION)
Remove items (typically soft delete/trash).
*   **Email**: Move to trash.
*   **Calendar**: Cancel event (not yet implemented).
*   **Automation**: Delete rule (not yet implemented).

### `analyze` (SAFE)
AI-powered analysis of items (Read-only).
*   **Email**: Summarize thread, extract action items.
*   **Calendar**: Find scheduling conflicts, suggest times.
