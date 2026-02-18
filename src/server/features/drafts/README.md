# Drafts (`src/server/features/drafts`)

Draft lifecycle helpers for email drafts created/edited/sent by the assistant.

## Key Files

- `service.ts`: domain service for draft operations
- `operations.ts`: low-level primitives used by routes/tools

Provider-specific draft APIs live in `src/server/integrations/google|microsoft`.

