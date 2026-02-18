
# Surfaces Sidecar

standalone service that connects chat platforms (Slack, Discord, Telegram) to the main Amodel brain.

## Setup

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Configure `.env` (see `surfaces/.env.example` for a dev-friendly template):
   - `CORE_BASE_URL` and `BRAIN_API_URL` should point at the running main app (default `http://localhost:3000`).
   - `SURFACES_SHARED_SECRET`, `JOBS_SHARED_SECRET`, and `INTERNAL_API_KEY` must match the main app.
   - Set platform tokens to enable connectors; a platform is skipped if its token is missing.

3. Run:
   ```bash
   bun install
   bun run dev
   ```

The sidecar listens on port `3001` by default and exposes `GET /health`.

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

When Core returns an `InteractivePayload` (e.g. draft created, approval request), the Sidecar renders platform-specific buttons. Approval actions use **secure signed action tokens** (Core generates tokenized approval links); the Sidecar or user follows the link, and Core verifies the token before executing (e.g. approve/deny, send email, triage action).
    
## Memory & Context

To provide a conversational experience:
-   **Context Fetching**: Should fetch the last 30 messages of the current thread/channel.
-   **Forwarding**: Passes this history in the `history` array to the Brain.
-   **Privacy**: This history is NOT stored in the Amodel database long-term; it is only used transiently for the current inference window.
