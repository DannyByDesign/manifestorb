import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    JOBS_SHARED_SECRET: z.string().optional(),
    SURFACES_SHARED_SECRET: z.string().optional(),
    INTERNAL_API_KEY: z.string().optional(),
    BRAIN_API_URL: z
      .string()
      .url()
      .default("http://localhost:3000/api/surfaces/inbound"),
    CORE_BASE_URL: z.string().url().default("http://localhost:3000"),
    SLACK_BOT_TOKEN: z.string().optional(),
    SLACK_APP_TOKEN: z.string().optional(),
    DISCORD_BOT_TOKEN: z.string().optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.NODE_ENV !== "production") return;

    const requiredKeys: Array<keyof typeof values> = [
      "DATABASE_URL",
      "REDIS_URL",
      "OPENAI_API_KEY",
      "GOOGLE_API_KEY",
      "JOBS_SHARED_SECRET",
      "SURFACES_SHARED_SECRET",
      "INTERNAL_API_KEY",
    ];

    for (const key of requiredKeys) {
      if (!values[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing required environment variable: ${key}`,
          path: [key],
        });
      }
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid sidecar environment variables:", parsed.error.flatten());
  throw new Error("Invalid sidecar environment variables");
}

export const env = parsed.data;
