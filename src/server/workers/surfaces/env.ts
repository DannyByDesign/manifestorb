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
    SURFACES_WORKER_PORT: z.coerce.number().int().positive().default(3400),
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

const appPort = Number.parseInt(process.env.PORT ?? "3000", 10);
const normalizedAppPort = Number.isFinite(appPort) ? appPort : 3000;
const defaultCoreBaseUrl = `http://127.0.0.1:${normalizedAppPort}`;
const defaultBrainApiUrl = `${defaultCoreBaseUrl}/api/surfaces/inbound`;

const mergedEnv = {
  ...process.env,
  CORE_BASE_URL: process.env.CORE_BASE_URL ?? defaultCoreBaseUrl,
  BRAIN_API_URL: process.env.BRAIN_API_URL ?? defaultBrainApiUrl,
  SURFACES_WORKER_PORT: process.env.SURFACES_WORKER_PORT ?? "3400",
  REDIS_URL:
    process.env.REDIS_URL ??
    process.env.REDIS_PRIVATE_URL ??
    process.env.REDIS_TLS_URL,
};

const parsed = envSchema.safeParse(mergedEnv);

if (!parsed.success) {
  console.error("Invalid surfaces worker environment variables:", parsed.error.flatten());
  throw new Error("Invalid surfaces worker environment variables");
}

export const env = parsed.data;
