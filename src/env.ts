import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";
import { booleanString } from "@/server/lib/zod";

const llmProviderEnum = z.enum(["google", "openai"]);

/** For Vercel preview deployments, auto-detect from VERCEL_URL. */
const getBaseUrl = (): string | undefined => {
  // Don't override for the OAuth proxy server (staging) - it needs its custom domain
  // for OAuth callbacks to work correctly
  const isOAuthProxyServer = process.env.IS_OAUTH_PROXY_SERVER === "true";
  if (
    process.env.VERCEL_ENV === "preview" &&
    process.env.VERCEL_URL &&
    !isOAuthProxyServer
  ) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return process.env.NEXT_PUBLIC_BASE_URL;
};

export const env = createEnv({
  server: {
    NODE_ENV: z.enum(["development", "production", "test"]),
    DATABASE_URL: z.string().url(),
    PREVIEW_DATABASE_URL: z.string().url().optional(),
    PREVIEW_DATABASE_URL_UNPOOLED: z.string().url().optional(),

    AUTH_SECRET: z.string().optional(),
    WORKOS_API_KEY: z.string().min(1),
    WORKOS_CLIENT_ID: z.string().min(1),
    WORKOS_COOKIE_PASSWORD: z.string().min(32),
    SURFACES_SHARED_SECRET: z.string().optional(), // Shared secret for Surfaces sidecar
    ADMIN_TOKEN: z.string().optional(), // For debug endpoints
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_TENANT_ID: z.string().optional().default("common"),
    EMAIL_ENCRYPT_SECRET: z.string(),
    EMAIL_ENCRYPT_SALT: z.string(),

    // LLM Configuration - Base tier uses Google Gemini 2.5 Flash for all tasks
    DEFAULT_LLM_PROVIDER: llmProviderEnum.default("google"),
    DEFAULT_LLM_MODEL: z.string().optional().default("gemini-2.5-flash"),
    // Economy and Chat use same model in base tier (all Gemini)
    ECONOMY_LLM_PROVIDER: llmProviderEnum.optional(),
    ECONOMY_LLM_MODEL: z.string().optional(),
    CHAT_LLM_PROVIDER: llmProviderEnum.optional(),
    CHAT_LLM_MODEL: z.string().optional(),

    // LLM API Keys (Google + OpenAI required)
    GOOGLE_API_KEY: z.string().min(1), // Primary provider for base tier
    OPENAI_API_KEY: z.string().min(1), // Required for embeddings only

    OPENAI_ZERO_DATA_RETENTION: booleanString.default(false),

    UPSTASH_REDIS_URL: z.string().optional(),
    UPSTASH_REDIS_TOKEN: z.string().optional(),

    QSTASH_TOKEN: z.string().optional(),
    QSTASH_CURRENT_SIGNING_KEY: z.string().optional(),
    QSTASH_NEXT_SIGNING_KEY: z.string().optional(),

    GOOGLE_PUBSUB_TOPIC_NAME: z.string().min(1),
    GOOGLE_PUBSUB_VERIFICATION_TOKEN: z.string().optional(),

    MICROSOFT_WEBHOOK_CLIENT_STATE: z.string().optional(),

    SENTRY_AUTH_TOKEN: z.string().optional(),
    SENTRY_ORGANIZATION: z.string().optional(),
    SENTRY_PROJECT: z.string().optional(),

    DISABLE_LOG_ZOD_ERRORS: booleanString,
    ENABLE_DEBUG_LOGS: booleanString.default(false),

    AI_RULE_TIMEOUT_MS: z.string().optional(),

    // Stripe
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    APPROVAL_ACTION_SECRET: z.string().optional(),

    API_KEY_SALT: z.string().optional(),

    POSTHOG_API_SECRET: z.string().optional(),
    POSTHOG_PROJECT_ID: z.string().optional(),

    RESEND_API_KEY: z.string().optional(),
    RESEND_AUDIENCE_ID: z.string().optional(),
    RESEND_FROM_EMAIL: z
      .string()
      .optional()
      .default("Amodel <updates@transactional.getamodel.com>"),
    CRON_SECRET: z.string().optional(),
    ADMINS: z
      .string()
      .optional()
      .transform((value) => value?.split(",")),
    WEBHOOK_URL: z.string().optional(),
    INTERNAL_API_URL: z.string().optional(),
    INTERNAL_API_KEY: z.string(),
    WHITELIST_FROM: z.string().optional(),
    USE_BACKUP_MODEL: booleanString.default(false),
    HEALTH_API_KEY: z.string().optional(),
    JOBS_SHARED_SECRET: z.string().optional(),
    CALENDAR_ACTIONS_DRY_RUN: booleanString.default(false),
    SIDECAR_URL: z.string().url().optional(), // URL of the surfaces sidecar for background jobs
    SURFACES_API_URL: z.string().url().optional(), // URL of the surfaces sidecar for push notifications
    OAUTH_PROXY_URL: z
      .preprocess(
        (value) =>
          typeof value === "string" && value.trim() === "" ? undefined : value,
        z.string().url().optional(),
      ),
    // Set to true on the server that acts as the OAuth proxy (e.g., staging)
    IS_OAUTH_PROXY_SERVER: booleanString.optional().default(false),
    // Additional trusted origins for CORS (comma-separated, supports wildcards like https://*.vercel.app)
    ADDITIONAL_TRUSTED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        value
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      ),

  },
  client: {
    // stripe
    NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY_PRICE_ID: z.string().optional(),
    NEXT_PUBLIC_STRIPE_BUSINESS_ANNUALLY_PRICE_ID: z.string().optional(),
    NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_MONTHLY_PRICE_ID: z.string().optional(),
    NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_ANNUALLY_PRICE_ID: z.string().optional(),

    NEXT_PUBLIC_WORKOS_REDIRECT_URI: z.string().url(),


    NEXT_PUBLIC_FREE_UNSUBSCRIBE_CREDITS: z.coerce.number().default(5),
    NEXT_PUBLIC_CALL_LINK: z
      .string()
      .default("https://cal.com/team/amodel/feedback"),
    NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_API_HOST: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_HERO_AB: z.string().optional(),
    NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_ID: z.string().optional(),
    NEXT_PUBLIC_BASE_URL: z.string().url(),
    NEXT_PUBLIC_CONTACTS_ENABLED: booleanString.default(false),
    NEXT_PUBLIC_EMAIL_SEND_ENABLED: booleanString.default(true),
    NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
    NEXT_PUBLIC_SUPPORT_EMAIL: z
      .string()
      .optional()
      .default("elie@getamodel.com"),
    NEXT_PUBLIC_WELCOME_UPGRADE_ENABLED: z.coerce
      .boolean()
      .optional()
      .default(false),
    NEXT_PUBLIC_LOG_SCOPES: z
      .string()
      .optional()
      .transform((value) => {
        if (!value) return;
        return value.split(",");
      }),
    NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE: z.coerce
      .boolean()
      .optional()
      .default(false),
    NEXT_PUBLIC_USE_AEONIK_FONT: booleanString.default(false),
    NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS: booleanString.default(false),
    NEXT_PUBLIC_DIGEST_ENABLED: booleanString.default(false),
    NEXT_PUBLIC_MEETING_BRIEFS_ENABLED: booleanString.default(false),
    NEXT_PUBLIC_FOLLOW_UP_REMINDERS_ENABLED: booleanString.default(false),
    NEXT_PUBLIC_INTEGRATIONS_ENABLED: booleanString.default(true),
    NEXT_PUBLIC_SMART_FILING_ENABLED: booleanString.default(false),
    NEXT_PUBLIC_CLEANER_ENABLED: booleanString.default(false),
    NEXT_PUBLIC_IS_RESEND_CONFIGURED: booleanString.default(false),
    NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED: booleanString.default(true),
  },
  // For Next.js >= 13.4.4, you only need to destructure client variables:
  experimental__runtimeEnv: {
    // stripe
    NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY_PRICE_ID:
      process.env.NEXT_PUBLIC_STRIPE_BUSINESS_MONTHLY_PRICE_ID,
    NEXT_PUBLIC_STRIPE_BUSINESS_ANNUALLY_PRICE_ID:
      process.env.NEXT_PUBLIC_STRIPE_BUSINESS_ANNUALLY_PRICE_ID,
    NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_MONTHLY_PRICE_ID:
      process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_MONTHLY_PRICE_ID,
    NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_ANNUALLY_PRICE_ID:
      process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PLUS_ANNUALLY_PRICE_ID,

    NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,


    NEXT_PUBLIC_CALL_LINK: process.env.NEXT_PUBLIC_CALL_LINK,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_API_HOST: process.env.NEXT_PUBLIC_POSTHOG_API_HOST,
    NEXT_PUBLIC_POSTHOG_HERO_AB: process.env.NEXT_PUBLIC_POSTHOG_HERO_AB,
    NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_ID:
      process.env.NEXT_PUBLIC_POSTHOG_ONBOARDING_SURVEY_ID,
    NEXT_PUBLIC_BASE_URL: getBaseUrl(),
    NEXT_PUBLIC_CONTACTS_ENABLED: process.env.NEXT_PUBLIC_CONTACTS_ENABLED,
    NEXT_PUBLIC_EMAIL_SEND_ENABLED: process.env.NEXT_PUBLIC_EMAIL_SEND_ENABLED,
    NEXT_PUBLIC_FREE_UNSUBSCRIBE_CREDITS:
      process.env.NEXT_PUBLIC_FREE_UNSUBSCRIBE_CREDITS,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    NEXT_PUBLIC_WELCOME_UPGRADE_ENABLED:
      process.env.NEXT_PUBLIC_WELCOME_UPGRADE_ENABLED,
    NEXT_PUBLIC_LOG_SCOPES: process.env.NEXT_PUBLIC_LOG_SCOPES,
    NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE:
      process.env.NEXT_PUBLIC_DISABLE_REFERRAL_SIGNATURE,
    NEXT_PUBLIC_USE_AEONIK_FONT: process.env.NEXT_PUBLIC_USE_AEONIK_FONT,
    NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS:
      process.env.NEXT_PUBLIC_BYPASS_PREMIUM_CHECKS,
    NEXT_PUBLIC_DIGEST_ENABLED: process.env.NEXT_PUBLIC_DIGEST_ENABLED,
    NEXT_PUBLIC_MEETING_BRIEFS_ENABLED:
      process.env.NEXT_PUBLIC_MEETING_BRIEFS_ENABLED,
    NEXT_PUBLIC_FOLLOW_UP_REMINDERS_ENABLED:
      process.env.NEXT_PUBLIC_FOLLOW_UP_REMINDERS_ENABLED,
    NEXT_PUBLIC_INTEGRATIONS_ENABLED:
      process.env.NEXT_PUBLIC_INTEGRATIONS_ENABLED,
    NEXT_PUBLIC_SMART_FILING_ENABLED:
      process.env.NEXT_PUBLIC_SMART_FILING_ENABLED,
    NEXT_PUBLIC_CLEANER_ENABLED: process.env.NEXT_PUBLIC_CLEANER_ENABLED,
    NEXT_PUBLIC_IS_RESEND_CONFIGURED:
      process.env.NEXT_PUBLIC_IS_RESEND_CONFIGURED,
    NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED:
      process.env.NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED,
  },
});

if (env.NODE_ENV === "production" && !env.AUTH_SECRET) {
  throw new Error("AUTH_SECRET is required in production");
}

if (env.NODE_ENV === "production") {
  if (!env.SURFACES_SHARED_SECRET) {
    throw new Error("SURFACES_SHARED_SECRET is required in production");
  }
  if (!env.JOBS_SHARED_SECRET) {
    throw new Error("JOBS_SHARED_SECRET is required in production");
  }
  if (!env.GOOGLE_PUBSUB_VERIFICATION_TOKEN) {
    throw new Error(
      "GOOGLE_PUBSUB_VERIFICATION_TOKEN is required in production",
    );
  }
}
