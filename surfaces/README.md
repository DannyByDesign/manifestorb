
# Surfaces Sidecar

standalone service that connects chat platforms (Slack, Discord, Telegram) to the main Amodel brain.

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Configure `.env`:
   ```bash
   CORE_BASE_URL=http://localhost:3000
   BRAIN_API_URL=http://localhost:3000/api/surfaces/inbound
   SURFACES_SHARED_SECRET=shared-secret-must-match-core-env
   
   # Tokens (Optional for local dev, service skips if missing)
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   DISCORD_BOT_TOKEN=...
   TELEGRAM_BOT_TOKEN=...
   ```

## Development

```bash
bun install
bun run dev
```

## Architecture

- **Connectors**:
  - `src/slack`: Socket Mode client
  - `src/discord`: Gateway client
  - `src/telegram`: Polling client
- **Core Loop**:
  1. Ingest message from platform.
  2. Normalize to `InboundMessage` (defined in Core).
  3. `forwardToBrain(...)` -> `POST /api/surfaces/inbound` on Core.
  4. Render response from Core back to platform.

## Interactive Elements

When Core returns an `InteractivePayload` (e.g. Approval Request), the Sidecar renders platform-specific buttons.
Clicking a button triggers a callback which the Sidecar routes to `POST /api/approvals/:id/(approve|deny)` on the Core.
