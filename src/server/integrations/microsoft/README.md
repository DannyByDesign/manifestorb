# Microsoft Integration (`src/server/integrations/microsoft`)

This module handles all interactions with the Microsoft Graph API (Outlook & Exchange).

## Core Capabilities

### 1. Outlook Sync (Graph API)
-   **`subscription-manager.ts`**: Manages Webhook subscriptions for `created`, `updated` events.
-   **`message.ts`**: Massive utility (700 lines) for KQL (Keyword Query Language) searching, parsing Graph Message objects, and handling attachments.
-   **`folders.ts`**: Maps "Well Known Folders" (Inbox, Sent, Drafts) to their changeable IDs.

### 2. Organization
-   **`label.ts`**: Maps Outlook "Categories" to our internal "Label" concept.
-   **`trash.ts`**: Move to Deleted Items.
-   **`draft.ts`**: Draft management.

### 3. Authentication
-   **`client.ts`**: Wraps `@microsoft/microsoft-graph-client`. Handles token refresh and client initialization.

### 4. Search & Filters
-   **`filter.ts`**: OData filter construction helpers.
-   **`message.ts`**: Contains the KQL Sanitizer to prevent injection attacks and syntax errors in search queries.
