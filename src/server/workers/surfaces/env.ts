import { z } from "zod";

const normalizeHttpUrl = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withProtocol);
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const normalizeCoreBaseUrl = (value: string): string => {
  const normalized = normalizeHttpUrl(value);
  const url = new URL(normalized);
  return url.origin;
};

const normalizeBrainApiUrl = (value: string): string => {
  const normalized = normalizeHttpUrl(value);
  const url = new URL(normalized);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/api/surfaces/inbound";
  }
  return url.toString();
};

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
      .min(1)
      .transform((value, ctx) => {
        try {
          return normalizeBrainApiUrl(value);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid BRAIN_API_URL",
          });
          return z.NEVER;
        }
      }),
    CORE_BASE_URL: z
      .string()
      .min(1)
      .transform((value, ctx) => {
        try {
          return normalizeCoreBaseUrl(value);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid CORE_BASE_URL",
          });
          return z.NEVER;
        }
      }),
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
