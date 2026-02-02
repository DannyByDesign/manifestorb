# Server Utilities (`src/server/utils`)

This directory contains over 300 files of shared helper logic. It acts as the "Standard Library" for the backend.

## Top-Level Helpers
-   **`logger.ts`**: Application-wide structured logging (JSON in prod, pretty in dev).
-   **`middleware.ts`**: Request context management.
-   **`auth.ts`**: Session validation helpers.
-   **`error.ts`**: Standardized error classes (`SafeError`).
-   **`encryption.ts`**: AES-256 helpers for sensitive tokens.
-   **`cron.ts`**: Vercel Cron verification.

## Major Submodules
-   **`ai/`**: Shared LLM interaction logic (see internal README).
-   **`outlook/`**: Microsoft-specific data structures (see internal README).
-   **`calendar/`**: Timezone and Event helpers (see internal README).
-   **`drive/`**: Google Drive / Attachment logic (see internal README).
-   **`email/`**: Generic email parsing and normalization.
-   **`parse/`**: HTML/Text parsing pipelines.
-   **`webhook/`**: Signature verification for inbound webhooks.
