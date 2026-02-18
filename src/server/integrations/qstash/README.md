# QStash Integration (`src/server/integrations/qstash`)

Thin wrapper around Upstash QStash for:
- publishing delayed/background jobs
- verifying signatures for inbound QStash callbacks

## Files

- `index.ts`: public exports
- `categorize-senders.ts`: example job publisher for sender categorization workflows

Higher-level job orchestration typically lives in feature modules (for example `features/notifications` schedules fallback pushes).

