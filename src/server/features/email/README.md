# Email (`src/server/features/email`)

Email domain logic and provider abstraction layer.

This module is responsible for:
- provider selection and capability unification (Gmail vs Outlook)
- processing provider history/webhook updates
- draft management helpers (reply-all, signatures, threading)
- mailbox watches/subscriptions

## Layout

- `provider.ts` + `provider-types.ts`: unified provider interface and factory
- `providers/`: provider-specific adapters that call `src/server/integrations/*`
- `watch-manager.ts`: provider watch/subscription lifecycle
- `process-history.ts`: convert provider history into normalized updates
- `threading.ts`, `thread-context.ts`: thread parsing and context helpers
- `draft-management.ts`: draft primitives used by tools/routes
- `unsubscribe.ts`: unsubscribe helpers

## Related Modules

- Google API wrappers: `src/server/integrations/google`
- Microsoft Graph wrappers: `src/server/integrations/microsoft`
- Webhook entrypoints: `src/server/features/webhooks`

