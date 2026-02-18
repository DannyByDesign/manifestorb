# Workers (`src/server/workers`)

Long-running background runtimes that are launched alongside the web server.

## Entrypoints

- `index.ts`: root worker bootstrap (respects `SURFACES_WORKER_ENABLED`)
- `surfaces/entrypoint.ts`: starts the surfaces worker runtime

## Runtime Model

The Railway service runs:
- web server: `next start`
- workers: `bun run src/server/workers/index.ts`

`start:all` supervises both processes so a worker crash fails fast and triggers restart.
