# Import Log (Repo B)

**Branch:** `import-backend`
**Source:** `inbox-zero` (Repo A)
**Target:** `amodel` (Repo B)

## Log
| Date | Action | Source | Destination | Status |
| :--- | :--- | :--- | :--- | :--- |
| 2026-01-29 | Init | - | `src/server/` | Created Directory Structure |
| 2026-01-29 | Copy | `apps/web/prisma/` | `prisma/` | Schema & Migrations Copied |
| 2026-01-29 | Copy | `apps/web/utils/prisma*.ts`, `encryption.ts` | `src/server/db/` | Database Client & Encryption Copied |
| 2026-01-29 | Copy | `apps/web/utils/gmail/`, `email/` | `src/server/integrations/google/` | Google Integration Logic Copied |
| 2026-01-29 | Copy | `apps/web/utils/upstash/` | `src/server/integrations/qstash/` | QStash Helpers Copied |
| 2026-01-29 | Copy | `apps/web/utils/ai/` | `src/server/integrations/ai/` | AI Logic Copied |
| 2026-01-29 | Copy | `apps/web/utils/actions/`, `process-history.ts` | `src/server/services/` | Business Logic Services Copied |
| 2026-01-29 | Copy | `apps/web/utils/logger.ts`, `middleware.ts`, `error.ts` | `src/server/utils/` | Shared Utilities Copied |
| 2026-01-29 | Copy | `apps/web/app/api/` (selected) | `src/app/api/` | API Routes Copied |
| 2026-01-29 | Copy | `apps/web/env.ts` | `src/env.ts` | Env Schema Copied |
