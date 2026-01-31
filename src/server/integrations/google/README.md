# Google Integration (`src/server/integrations/google`)

This module handles all interactions with the Gmail API and Google Calendar API.

## Core Capabilities

### 1. Gmail Sync
-   **`watch-manager.ts`**: Manages Gmail Push Notifications (Pub/Sub).
-   **`history.ts`**: Fetches partial sync updates using `historyId`.
-   **`message.ts`**: Fetches full message content, parses MIME parts, and handles attachments.
-   **`thread.ts`**: logic for threading interactions.

### 2. Organization & Modifiers
-   **`label.ts`**: Fetching, Creating, and resolving System vs User labels.
-   **`trash.ts`**: Soft delete logic.
-   **`draft.ts`**: Creating and updating drafts (supporting reply/forward metadata).

### 3. Authentication & Client
-   **`provider.ts`**: The main `GoogleEmailProvider` class that implements the shared `EmailProvider` interface.
-   **`client.ts`**: Wraps `googleapis` client instantiation with `oAuth2Client` refresh logic.

### 4. Utilities
-   **`permissions.ts`**: Scope verification.
-   **`signature-settings.ts`**: Extracts the user's HTML signature from Gmail settings.
-   **`batch.ts`**: Helpers for batching requests (if supported).
