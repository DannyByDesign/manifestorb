# Reply Tracker (`src/server/features/reply-tracker`)

Detect and manage thread reply status (needs reply, awaiting reply, nudges/follow-ups) and generate drafts.

## Layout

- `ai/`: LLM helpers (draft replies, follow-ups, thread status classification)
- `handle-*` files: inbound/outbound handling and status updates
- `draft-tracking.ts`: persistence and tracking for draft lifecycle in reply workflows
- `conversation-status-config.ts`: configuration for status rules

