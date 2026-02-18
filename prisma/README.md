# Prisma (`prisma/`)

This directory contains the main app database schema and migrations.

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Generated client output: `generated/prisma/` (do not edit by hand)

## Common Commands

```bash
# Generate Prisma client (main app)
bun run prisma:generate:web

# Create/apply migrations in dev
bunx prisma migrate dev --schema prisma/schema.prisma

# Apply existing migrations in deploy environments
bun run prisma:migrate:deploy

# Predeploy helper (wrapper script used by some deploy targets)
bun run prisma:migrate:predeploy
```

## Local Dev Database

`docker-compose.dev.yml` starts a Postgres image with pgvector support. With the default compose config:
- user: `postgres`
- password: `postgres`
- db: `amodel`
- port: `5432`

Example `DATABASE_URL`:
```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/amodel?schema=public"
```

