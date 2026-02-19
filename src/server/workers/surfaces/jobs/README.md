# Background Jobs (`src/server/workers/surfaces/jobs`)

This directory contains long-running job workers executed by the surfaces worker runtime.

Why this worker runtime:
- Chat connectors (Slack/Discord/Telegram) require persistent process state.
- Memory and embedding pipelines are safer in retryable long-lived workers.
- Main app and worker run in one Railway service (no separate surfaces deployment).

## Jobs

### Memory Recording (`recording-worker.ts`)

Purpose: user-level summarization + fact extraction across *all* conversation messages for a user (unified memory).

Key behaviors:
- delegates to core route `POST /api/jobs/record-memory`
- preserves worker-facing response shape for scheduler/trigger callers

Triggered by:
- main app: `src/server/features/memory/service.ts` enqueues to the co-located surfaces worker when `JOBS_SHARED_SECRET` is configured
- surfaces worker HTTP endpoint: `POST /jobs/recording` (Authorization: `Bearer ${JOBS_SHARED_SECRET}`)

### Embedding Worker (`embedding-worker.ts`)

Purpose: drain the embedding queue and generate OpenAI embeddings (used for semantic search).

Key behaviors:
- delegates to core route `POST /api/jobs/process-embeddings`
- returns processed/recovered counts and queue stats to scheduler/status endpoints

### Decay Worker (`decay-worker.ts`)

Purpose: apply retention/decay rules to long-term memory facts.

Key behaviors:
- delegates to core route `POST /api/jobs/memory-decay`
- keeps local stats query for status visibility

### Scheduler (`scheduler.ts`)

Purpose: run periodic jobs and expose manual triggers.

Exposed endpoints (see `src/server/workers/surfaces/index.ts`):
- `GET /health`
- `GET /jobs/status`
- `POST /jobs/embeddings` (Bearer `JOBS_SHARED_SECRET`)
- `POST /jobs/decay` (Bearer `JOBS_SHARED_SECRET`)

## Required Environment

The important bits:
- `DATABASE_URL` (same database as the main app)
- `REDIS_URL`
- `OPENAI_API_KEY` (embeddings)
- `GOOGLE_API_KEY` (memory recording)
- `JOBS_SHARED_SECRET` (auth for job endpoints)
