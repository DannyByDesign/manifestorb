# Webhooks (`src/server/features/webhooks`)

Inbound webhook processing from external providers (Gmail, Outlook, Calendar, etc.).

## Key Files

- `validate-webhook-account.ts`: resolve and validate the account for an inbound webhook
- `process-history-item.ts`: normalize and process provider history items
- `error-handler.ts`: standard error handling for webhook routes

Webhook HTTP entrypoints live under `src/app/api/*`.

