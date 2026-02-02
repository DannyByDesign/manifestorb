# Background Jobs

This directory contains background job workers that run in the surfaces sidecar.

## Why Here?

Background jobs run in the surfaces sidecar instead of Vercel because:
1. **No timeout limits** - Jobs can run as long as needed
2. **Cost effective** - No need for Vercel Enterprise
3. **Clean separation** - Vercel handles web, sidecar handles background

## Jobs

### Recording Worker (`recording-worker.ts`)

Processes memory recording (summarization + fact extraction):
- Called immediately when user hits 120K token threshold
- Receives HTTP POST from main app at `/jobs/recording`
- Calls OpenAI for summarization and fact extraction
- Stores UserSummary and MemoryFacts
- Enqueues embeddings for new facts

**Trigger:** Immediate (HTTP push from main app)
**Backup:** Every 30 minutes (catches missed triggers)

### Embedding Worker (`embedding-worker.ts`)

Processes the embedding queue:
- Reads jobs from Redis queue
- Generates embeddings via OpenAI API
- Stores vectors in PostgreSQL (pgvector)
- Handles retries and failed jobs

**Schedule:** Every 5 minutes

### Decay Worker (`decay-worker.ts`)

Manages memory lifecycle:
1. Marks stale facts as inactive (180+ days without access)
2. Deletes old inactive facts (30+ days inactive)

**Schedule:** Daily at 3:00 AM UTC

### Scheduler (`scheduler.ts`)

Cron scheduler that runs the jobs automatically.

## HTTP Endpoints

The sidecar exposes these endpoints for job management:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/jobs/status` | None | Get queue and decay stats |
| POST | `/jobs/embeddings` | Bearer token | Manually trigger embedding processing |
| POST | `/jobs/decay` | Bearer token | Manually trigger memory decay |
| GET | `/health` | None | Health check |

## Environment Variables

Required in `.env`:

```env
# Database (same as main app)
DATABASE_URL="postgresql://..."

# Redis (same as main app)  
REDIS_URL="redis://..."

# OpenAI for embeddings
OPENAI_API_KEY="sk-..."

# Auth for manual job triggers
JOBS_SHARED_SECRET="..."
```

## Development

```bash
# Install dependencies (generates Prisma client)
bun install

# Run in development mode
bun run dev
```

## Production Deployment

### Railway

1. **Create a new service** from the `surfaces` directory
2. **Set build command:** `bun install`
3. **Set start command:** `bun run start`
4. **Add environment variables:**
   - `DATABASE_URL` - Same PostgreSQL connection as main app
   - `REDIS_URL` - Same Redis connection as main app
   - `OPENAI_API_KEY` - For embedding generation
   - `JOBS_SHARED_SECRET` - For authenticated job triggers
   - Platform tokens: `SLACK_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`

### AWS (ECS/EC2)

1. **Build Docker image:**
   ```dockerfile
   FROM oven/bun:1
   WORKDIR /app
   COPY package.json bun.lock ./
   COPY prisma ./prisma
   RUN bun install --production
   COPY src ./src
   CMD ["bun", "run", "start"]
   ```

2. **Deploy** as a long-running service (not Lambda/serverless)

3. **Configure** environment variables in your secrets manager

### Health Monitoring

The `/health` endpoint returns uptime and can be used for:
- Load balancer health checks
- Uptime monitoring (e.g., UptimeRobot, Pingdom)

```bash
curl https://your-surfaces-host/health
# {"status":"ok","uptime":12345.67}
```

### Job Monitoring

Check job queue status:

```bash
curl https://your-surfaces-host/jobs/status
# {"embedding":{"pending":5,"processing":0,"failed":0},"decay":{"totalFacts":100,...}}
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Surfaces Sidecar                          │
├──────────────────────────────────────────────────────────────┤
│  Platform Connectors          │  Background Jobs             │
│  ├── Slack (WebSocket)        │  ├── Embedding Worker        │
│  ├── Discord (Gateway)        │  ├── Decay Worker            │
│  └── Telegram (Polling)       │  └── Scheduler (cron)        │
├──────────────────────────────────────────────────────────────┤
│                       Data Layer                             │
│  ├── Prisma (PostgreSQL)                                     │
│  └── Redis (Queue)                                           │
└──────────────────────────────────────────────────────────────┘
```
