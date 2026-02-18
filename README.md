# Amodel

Product: an AI assistant for email and calendar workflows (drafting, scheduling, triage, automation) with explicit approval gates for sensitive actions.

Repo: a Next.js app in `src/` plus co-located long-running workers in `src/server/workers/` for chat platforms (Slack/Discord/Telegram) and background jobs.

## Quick Start (Local Dev)

Prereqs:
- Bun (this repo pins `bun@1.2.2` in `package.json`)
- Docker (for Postgres + Redis in `docker-compose.dev.yml`)

1. Start local dependencies:
   ```bash
   docker compose -f docker-compose.dev.yml up -d
   ```

2. Configure environment:
   - Copy `/.env.example` to `/.env.local` (recommended for Next.js local dev).
   - Fill required values. The authoritative schema is `src/env.ts`.

3. Install deps (also runs Prisma generate via `postinstall`):
   ```bash
   bun install
   ```

4. Run migrations:
   ```bash
   bunx prisma migrate dev --schema prisma/schema.prisma
   ```

5. Run the web app:
   ```bash
   bun run dev
   ```

Optional: run web app + worker together:
```bash
bun run dev:stack
```

## Common Commands

```bash
# Build / run
bun run build
bun run start
bun run start:all
bun run worker

# Lint
bun run lint
bun run lint:changed

# Tests
bun run test-ai
bun run test:integration
bun run test:e2e
bun run test:evals
```

## Configuration

- Environment variable schema: `src/env.ts`
- Main app template: `/.env.example`
- Worker internals: `src/server/workers/README.md`

Notes:
- WorkOS AuthKit is the auth system for the web app (`src/server/auth`).
- The main assistant model defaults to Google Gemini (see `DEFAULT_LLM_*` in `src/env.ts`).
- Embeddings use OpenAI (`text-embedding-3-small`). `OPENAI_API_KEY` is required for memory/knowledge semantic search and for runtime semantic tool ranking when enabled.
- Web search tools are optional. Enable/configure via `TOOL_WEB_SEARCH_*` in `src/env.ts` and provide a provider key (for example `BRAVE_API_KEY` or `PERPLEXITY_API_KEY`).

## Where To Look

- Source map / entrypoints: `src/ARCHITECTURE_MAP.md`
- Architecture overview: `ARCHITECTURE.md`
- Backend organization: `src/server/README.md`
- Surfaces worker details: `src/server/workers/surfaces/README.md`
- E2E test harness: `tests/e2e/README.md`
