# Slack Integration (`src/server/integrations/slack`)

Slack OAuth and API helpers used by the main app.

Notes:
- The **surfaces worker** (`src/server/workers/surfaces/`) owns Slack Socket Mode connectivity and message delivery.
- The **main app** owns account linking, tokens, and user mapping (Slack user -> Amodel user).

## Files

- `oauth.ts`: Slack OAuth helpers (linking accounts)
- `constants.ts`: Slack constants/scopes and shared values
