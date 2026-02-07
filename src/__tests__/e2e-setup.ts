/**
 * Setup for critical E2E tests (real DB, real Google).
 * No mocks for app/DB; minimal stubs only for Next.js–only packages so Vitest can load (no next/cache in Node).
 * Use with: RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts
 */
import { vi } from "vitest";
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const envFileCandidates = [".env.test.local", ".env.test"];
if (process.env.RUN_LIVE_E2E === "true") {
  for (const envFile of envFileCandidates) {
    const envPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      loadEnv({ path: envPath, override: false });
    }
  }
}

const setDefaultEnv = (key: string, value: string) => {
  if (!process.env[key]) {
    process.env[key] = value;
  }
};

setDefaultEnv("NODE_ENV", "test");
setDefaultEnv("DATABASE_URL", process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/amodel");
setDefaultEnv("GOOGLE_CLIENT_ID", process.env.GOOGLE_CLIENT_ID ?? "test-google-client-id");
setDefaultEnv("GOOGLE_CLIENT_SECRET", process.env.GOOGLE_CLIENT_SECRET ?? "test-google-client-secret");
setDefaultEnv("EMAIL_ENCRYPT_SECRET", process.env.EMAIL_ENCRYPT_SECRET ?? "test-email-encrypt-secret-32chars");
setDefaultEnv("EMAIL_ENCRYPT_SALT", process.env.EMAIL_ENCRYPT_SALT ?? "test-email-encrypt-salt");
setDefaultEnv("GOOGLE_API_KEY", process.env.GOOGLE_API_KEY ?? "test-google-api-key");
setDefaultEnv("OPENAI_API_KEY", process.env.OPENAI_API_KEY ?? "test-openai-api-key");
setDefaultEnv(
  "GOOGLE_PUBSUB_TOPIC_NAME",
  process.env.GOOGLE_PUBSUB_TOPIC_NAME ?? "projects/test-project/topics/amodel-emails",
);
setDefaultEnv("INTERNAL_API_KEY", process.env.INTERNAL_API_KEY ?? "test-internal-api-key");
setDefaultEnv("NEXT_PUBLIC_BASE_URL", process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");
setDefaultEnv("WORKOS_API_KEY", process.env.WORKOS_API_KEY ?? "test-workos-api-key");
setDefaultEnv("WORKOS_CLIENT_ID", process.env.WORKOS_CLIENT_ID ?? "test-workos-client-id");
setDefaultEnv(
  "WORKOS_COOKIE_PASSWORD",
  process.env.WORKOS_COOKIE_PASSWORD ?? "test-workos-cookie-password-32chars",
);
setDefaultEnv(
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? "http://localhost:3000/callback",
);
setDefaultEnv("UPSTASH_REDIS_URL", process.env.UPSTASH_REDIS_URL ?? "https://test-redis.upstash.io");
setDefaultEnv("UPSTASH_REDIS_TOKEN", process.env.UPSTASH_REDIS_TOKEN ?? "test-redis-token");
setDefaultEnv("NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED", "true");

// next/server after() runs synchronously in tests so callbacks complete
vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    after: async (fn: () => void | Promise<void>) => {
      return await fn();
    },
  };
});

// Stub Next.js–only packages so Vitest can load (no next/cache in Node). E2E does not assert on auth.
vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn().mockResolvedValue({ user: null }),
  getSignInUrl: vi.fn().mockResolvedValue("http://localhost/login"),
  handleAuth: vi.fn(() => () => new Response(null, { status: 302 })),
  signOut: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  AuthKitProvider: ({ children }: { children: ReactNode }) => children,
}));
