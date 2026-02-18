# Surfaces Worker (`src/server/workers/surfaces`)

Owns external chat connectors and long-running jobs.

## Where to edit connectors

- Slack: `src/server/workers/surfaces/connectors/slack/index.ts`
- Discord: `src/server/workers/surfaces/connectors/discord/index.ts`
- Telegram: `src/server/workers/surfaces/connectors/telegram/index.ts`

## Connector-adjacent runtime modules

- Delivery dedupe + ack: `src/server/workers/surfaces/delivery.ts`
- Cross-platform message utilities: `src/server/workers/surfaces/utils.ts`
- Platform startup/health state: `src/server/workers/surfaces/platform-status.ts`
- Ingress transport to core runtime: `src/server/workers/surfaces/transport/brain-ingress.ts`

## Background jobs

- Scheduler: `src/server/workers/surfaces/jobs/scheduler.ts`
- Memory recording: `src/server/workers/surfaces/jobs/recording-worker.ts`
- Embeddings: `src/server/workers/surfaces/jobs/embedding-worker.ts`
- Memory decay: `src/server/workers/surfaces/jobs/decay-worker.ts`
- Calendar reconcile trigger: `src/server/workers/surfaces/jobs/calendar-reconcile.ts`

## Runtime entrypoint

- `src/server/workers/surfaces/index.ts` exposes HTTP endpoints used internally by the web runtime and starts connectors/schedulers.
- `src/server/workers/surfaces/entrypoint.ts` is the executable bootstrap.
