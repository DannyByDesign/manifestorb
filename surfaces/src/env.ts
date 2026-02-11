import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    JOBS_SHARED_SECRET: z.string().min(1).optional(),
    SURFACES_SHARED_SECRET: z.string().min(1),
    INTERNAL_API_KEY: z.string().min(1).optional(),
    BRAIN_API_URL: z
      .string()
      .url()
      .default("http://localhost:3000/api/surfaces/inbound"),
    CORE_BASE_URL: z.string().url().default("http://localhost:3000"),
    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_APP_TOKEN: z.string().optional(),
    DISCORD_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid sidecar environment variables:", parsed.error.flatten());
  throw new Error("Invalid sidecar environment variables");
}

export const env = parsed.data;
