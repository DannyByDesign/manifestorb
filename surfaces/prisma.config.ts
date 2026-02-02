import 'dotenv/config';
import { defineConfig, env } from "prisma/config";

export default defineConfig({
    schema: 'prisma/schema.prisma',
    datasource: {
        url: env("DATABASE_URL")
    },
    // No migrations - use main app for migrations
});
