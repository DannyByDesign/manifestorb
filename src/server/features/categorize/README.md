# Categorization (`src/server/features/categorize`)

Sender categorization and related automation helpers.

## Layout

- `ai/`: LLM helpers used to categorize senders and propose categories
- `senders/`: sender-oriented categorization logic and storage

Provider integration for bulk operations lives under `src/server/integrations/` (for example `integrations/qstash` for scheduling and `integrations/google|microsoft` for mailbox operations).

