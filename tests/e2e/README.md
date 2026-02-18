# E2E Tests

## Critical E2E (Web + Google)

- **Config:** `vitest.e2e.config.ts`
- **Env:** Set `RUN_LIVE_E2E=true` and provide LIVE_* vars in `.env.test.local` (see critical-e2e-harness.ts).
- **Run:** `RUN_LIVE_E2E=true bunx vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-*.test.ts`

## Slack ↔ Main App ↔ Google E2E

Three-way integration tests: Slack (surfaces worker) ↔ Main App (agent) ↔ Google Suite (Gmail/Calendar).

### Env

- **Slack:** `SLACK_BOT_TOKEN`, `TEST_SLACK_CHANNEL_ID`, `TEST_SLACK_USER_ID`. Put these in `.env.local` and/or `.env.test.local`.
- **Slack (messages as you):** Optional `TEST_SLACK_USER_TOKEN` — a **user** OAuth token (starts with `xoxp-`, **not** the bot token `xoxb-`) with scope `chat:write:user`. When set, messages posted by the tests appear as you instead of the bot. To get it: Slack app → OAuth & Permissions → add User Token Scopes `chat:write:user` (and `chat:write` if needed) → Reinstall to workspace → copy the **OAuth Access Token** (the `xoxp-...` one) into `.env.test.local` or `.env.local` as `TEST_SLACK_USER_TOKEN`. If you see "[Slack E2E] Posting as bot" in test output, this var is missing or wrong.
- **Main app:** `SURFACES_SHARED_SECRET`, `NEXT_PUBLIC_BASE_URL` (e.g. `http://localhost:3000`). For simulated inbound tests, the main app must be running at that URL.
- **Google (Tiers 2–3, 5):** Same as Critical E2E: set `RUN_LIVE_E2E=true` and LIVE_* vars so `loadLiveContext()` works.
- **Linking:** The Slack user ID (`TEST_SLACK_USER_ID`) must be linked to the Amodel user used by LIVE_* (an `Account` row with `provider: "slack"` and `providerAccountId` = that Slack user ID). Otherwise the inbound API returns "link your account".

### Run

- **Tier 1 only (simulated round-trip):** Main app running; no worker or real Slack required for the simulated test.
  ```bash
  RUN_LIVE_SLACK_GOOGLE_E2E=true SURFACES_SHARED_SECRET=your-secret bunx vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-slack-google-tier1-basic.test.ts
  ```
- **Full three-way (all tiers):** Main app (e.g. port 3000) and surfaces worker (e.g. port 3400) running; Slack env set. Test files run **serially** (fileParallelism: false) and each test waits **15s** before starting, and each Slack message post waits **15s** after sending (in the harness) so messages are spaced and the bot isn’t flooded. The bot replies in the **channel** (not in threads). User follow-ups are sent as **top-level channel messages** (no `thread_ts`), and tests wait for the bot via `waitForSlackChannelResponse(channel, { afterTs })` (not thread replies). For multi-turn tests, send each follow-up **after** the AI responds so the bot isn’t given multiple messages in a row. so the bot isn't flooded; messages stay ordered and the model isn't confused by multiple concurrent requests.
  ```bash
  RUN_LIVE_SLACK_GOOGLE_E2E=true RUN_LIVE_E2E=true bunx vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-slack-google-*.test.ts
  ```

### Tiers

- **Tier 1:** Basic communication (simulated + full round-trip; proactive skipped).
- **Tier 2:** Google triggers from Slack (calendar read, Gmail read, calendar write, email send with approval).
- **Tier 3:** Multi-step workflows (email → Slack → reply → calendar; conflict → reschedule → email).
- **Tier 4:** Error handling (rapid-fire, ambiguous messages; connection/rate-limit/token tests skipped).
- **Tier 5:** Slack-specific (thread context, channel reply, interactive elements).
