
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

## Credential Setup Guide

### Slack
**No paid account required.** Just a free Slack workspace.
1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** -> **From an app manifest**.
3. Pick your workspace and paste this YAML:

```yaml
display_information:
  name: Amodel
features:
  bot_user:
    display_name: Amodel
    always_online: true
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - im:history
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.im
  interactivity:
    is_enabled: true
  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false
```
4. Click **Create** -> **Install to Workspace**.
5. Copy **Bot User OAuth Token** (`xoxb-...`) -> `SLACK_BOT_TOKEN`.
6. Go to **Basic Information** -> **App-Level Tokens** -> **Generate Token and Scopes** (add `connections:write`).
7. Copy **App-Level Token** (`xapp-...`) -> `SLACK_APP_TOKEN`.

### Discord
1. Go to [discord.com/developers/applications](https://discord.com/developers/applications).
2. New Application -> Bot -> **Reset Token** -> `DISCORD_BOT_TOKEN`.
3. Enable **Message Content Intent** (required).

### Telegram
1. Message `@BotFather` on Telegram.
2. `/newbot` -> Follow prompt.
3. Copy API Token -> `TELEGRAM_BOT_TOKEN`.

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
