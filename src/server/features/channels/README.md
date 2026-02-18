# Channels (`src/server/features/channels`)

Channel/surface orchestration for non-web chat platforms (Slack/Discord/Telegram).

This module:
- normalizes inbound platform messages into a unified shape
- runs the unified AI runtime
- returns platform-friendly payloads (including interactive actions like "Send", "Approve", etc.)

## Key Files

- `router.ts`: inbound routing decisions (platform, channel/thread keys)
- `executor.ts`: one-shot turn executor (calls into `features/ai`)
- `conversation-key.ts`: stable keys for mapping platform threads to conversations
- `surface-account.ts`: surface account linking helpers
- `types.ts`: shared channel types

