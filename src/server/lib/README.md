# Server Utilities (`src/server/lib`)

This directory contains shared helper logic and cross-cutting utilities used by multiple features.

## Top-Level Helpers
-   **`logger.ts`**: Application-wide structured logging (JSON in prod, pretty in dev).
-   **`middleware.ts`**: Request context management.
-   **`auth.ts`**: Session validation helpers.
-   **`error.ts`**: Standardized error classes (`SafeError`).
-   **`encryption.ts`**: AES-256 helpers for sensitive tokens.
-   **`cron.ts`**: Vercel Cron verification.

## Major Submodules
-   **`llms/`**: LLM provider abstraction and AI helpers.
-   **`redis/`**: Caching utilities and Redis client.
-   **`queue/`**: QStash queue utilities.
-   **`parse/`**: HTML/Text parsing pipelines.
-   **`webhook/`**: Signature verification for inbound webhooks.

## Usage

```typescript
import { createScopedLogger } from "@/server/lib/logger";
import { redis } from "@/server/lib/redis";
import { SafeError } from "@/server/lib/error";

const logger = createScopedLogger("my-feature");
logger.info("Hello world");
```

## Note

Feature-specific utilities should go in `features/[feature]/` rather than here.
Integrations with external APIs go in `integrations/` rather than here.
