# Assistant Email (`src/server/features/assistant-email`)

Support for "assistant-via-email" workflows (e.g. `user+assistant@...` style addresses).

## Key Files

- `is-assistant-email.ts`: detection logic
- `process-assistant-email.ts`: main processing entrypoint

If you change the address conventions or parsing rules, update `is-assistant-email.test.ts`.

