import { beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import prismaMock, { resetPrismaMock } from "@/server/lib/__mocks__/prisma";

const envFileCandidates = [".env.test.local", ".env.test"];
const shouldLoadTestEnv =
  process.env.RUN_AI_TESTS === "true" || process.env.RUN_LIVE_E2E === "true";
if (shouldLoadTestEnv) {
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

// Required env vars for tests (keep deterministic placeholders)
setDefaultEnv("NODE_ENV", "test");
setDefaultEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/amodel");
setDefaultEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
setDefaultEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
setDefaultEnv("EMAIL_ENCRYPT_SECRET", "test-email-encrypt-secret-32chars");
setDefaultEnv("EMAIL_ENCRYPT_SALT", "test-email-encrypt-salt");
setDefaultEnv("GOOGLE_API_KEY", "test-google-api-key");
setDefaultEnv("OPENAI_API_KEY", "test-openai-api-key");
setDefaultEnv(
  "GOOGLE_PUBSUB_TOPIC_NAME",
  "projects/test-project/topics/amodel-emails",
);
setDefaultEnv("INTERNAL_API_KEY", "test-internal-api-key");
setDefaultEnv("NEXT_PUBLIC_BASE_URL", "http://localhost:3000");
setDefaultEnv("WORKOS_API_KEY", "test-workos-api-key");
setDefaultEnv("WORKOS_CLIENT_ID", "test-workos-client-id");
setDefaultEnv(
  "WORKOS_COOKIE_PASSWORD",
  "test-workos-cookie-password-32chars",
);
setDefaultEnv(
  "NEXT_PUBLIC_WORKOS_REDIRECT_URI",
  "http://localhost:3000/callback",
);
setDefaultEnv("UPSTASH_REDIS_URL", "https://test-redis.upstash.io");
setDefaultEnv("UPSTASH_REDIS_TOKEN", "test-redis-token");
setDefaultEnv("NEXT_PUBLIC_CALENDAR_SCHEDULING_ENABLED", "true");

// Mock next/server's after() to just run synchronously in tests
vi.mock("next/server", async () => {
  const actual = await vi.importActual("next/server");
  return {
    ...actual,
    after: async (fn: () => void | Promise<void>) => {
      // In tests, just run the function synchronously
      return await fn();
    },
  };
});

// Mock QStash signature verification for tests
vi.mock("@upstash/qstash/nextjs", () => ({
  verifySignatureAppRouter: vi.fn((handler) => handler),
}));

vi.mock("@workos-inc/authkit-nextjs", () => ({
  withAuth: vi.fn().mockResolvedValue({ user: null }),
  getSignInUrl: vi.fn().mockResolvedValue("http://localhost/login"),
  handleAuth: vi.fn(() => () => new Response(null, { status: 302 })),
  signOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workos-inc/authkit-nextjs/components", () => ({
  AuthKitProvider: ({ children }: { children: ReactNode }) => children,
}));

// Mock Prisma client for unit tests by default; use real client for live E2E
vi.mock("@/server/db/client", async (importOriginal) => {
  if (process.env.RUN_LIVE_E2E === "true") {
    const actual = await importOriginal<typeof import("@/server/db/client")>();
    return { default: actual.default };
  }
  return { default: prismaMock };
});

beforeEach(() => {
  if (process.env.RUN_LIVE_E2E !== "true") {
    resetPrismaMock();
  }
});
