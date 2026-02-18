# Integrations Feature (`src/server/features/integrations`)

App-level integration flows that sit above low-level provider API wrappers.

## Key Files

- `post-oauth.ts`: post-OAuth linking/finalization for connected accounts
- `status.ts`: integration status helpers (what's connected, health, etc.)

Provider API clients live under `src/server/integrations/` (Google/Microsoft/Slack/QStash).

