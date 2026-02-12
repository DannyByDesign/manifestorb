# Google Integration (`src/server/integrations/google`)

This module handles interactions with the Gmail API and Google Calendar API.

## Core Capabilities

### 1. Gmail Sync
-   **`watch-manager.ts`**: Manages Gmail Push Notifications (Pub/Sub).
-   **`history.ts`**: Fetches partial sync updates using `historyId`.
-   **`message.ts`**: Fetches full message content, parses MIME parts, and handles attachments.
-   **`thread.ts`**: Threading logic.

### 2. Organization & Modifiers
-   **`label.ts`**: Fetching, creating, and resolving System vs User labels.
-   **`trash.ts`**: Soft delete logic.
-   **`draft.ts`**: Creating and updating drafts (reply/forward metadata).
-   **`mail.ts`**: Sending email (used by the AI `send` tool when user approves).

### 3. Authentication & Client
-   **`provider.ts`**: The main `GoogleEmailProvider` class implementing the shared `EmailProvider` interface.
-   **`client.ts`**: Wraps `googleapis` with `oAuth2Client` refresh logic.

### 4. Calendar (in app)
-   **Calendar**: Event CRUD, watch, incremental sync. Watch renewal: `POST /api/google/calendar/watch/renew` (CRON_SECRET).

### 5. Utilities
-   **`permissions.ts`**: Scope verification.
-   **`signature-settings.ts`**: Extracts the user's HTML signature from Gmail settings.
-   **`batch.ts`**: Batching helpers (if supported).
