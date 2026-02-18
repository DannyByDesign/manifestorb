# Background Jobs (`surfaces/src/jobs`)

This directory contains background job workers that run in the surfaces sidecar.

Why the sidecar:
- Vercel/serverless environments have execution time limits.
- Slack Socket Mode and other connectors need persistent processes.
- Some jobs (memory recording, embedding backfills) are safer to run in a long-lived worker with retries.

## Jobs

### Memory Recording (`recording-worker.ts`)

Purpose: user-level summarization + fact extraction across *all* conversation messages for a user (unified memory).

Key behaviors:
- fetches new `ConversationMessage`s since `UserSummary.lastMessageAt`
- calls Gemini (`gemini-2.5-flash`) to produce a compressed summary + extracted facts
- upserts `UserSummary` + `MemoryFact`s
- enqueues embeddings for new/updated facts into Redis (LPUSH to an embedding queue key)

Triggered by:
- main app: `src/server/features/memory/service.ts` enqueues a job to the sidecar (`SIDECAR_URL`) when `JOBS_SHARED_SECRET` is configured
- sidecar HTTP endpoint: `POST /jobs/recording` (Authorization: `Bearer ${JOBS_SHARED_SECRET}`)

### Embedding Worker (`embedding-worker.ts`)

Purpose: drain the embedding queue and generate OpenAI embeddings (used for semantic search).

Key behaviors:
- reads queued jobs from Redis
- calls OpenAI embeddings (`text-embedding-3-small`)
- stores vectors in Postgres (pgvector fields on the relevant model)

### Decay Worker (`decay-worker.ts`)

Purpose: apply retention/decay rules to long-term memory facts.

Key behaviors:
- marks stale facts inactive
- deletes older inactive facts according to retention rules

### Scheduler (`scheduler.ts`)

Purpose: run periodic jobs and expose manual triggers.

Exposed endpoints (see `surfaces/src/index.ts`):
- `GET /health`
- `GET /jobs/status`
- `POST /jobs/embeddings` (Bearer `JOBS_SHARED_SECRET`)
- `POST /jobs/decay` (Bearer `JOBS_SHARED_SECRET`)

## Required Environment

See `surfaces/.env.example` for a dev-friendly template. The important bits:
- `DATABASE_URL` (same database as the main app)
- `REDIS_URL`
- `OPENAI_API_KEY` (embeddings)
- `GOOGLE_API_KEY` (memory recording)
- `JOBS_SHARED_SECRET` (auth for job endpoints)

