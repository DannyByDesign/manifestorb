import 'dotenv/config';
import { defineConfig } from "prisma/config";

// Prisma generate during Docker image build should not depend on runtime-only secrets.
// Runtime env validation (src/env.ts) still enforces DATABASE_URL before the service starts.
const buildSafeDatabaseUrl =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

export default defineConfig({
    schema: 'prisma/schema.prisma',
    datasource: {
        url: buildSafeDatabaseUrl
    },
    // No migrations - use main app for migrations
});
