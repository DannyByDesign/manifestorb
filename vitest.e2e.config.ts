import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Config for critical E2E tests (real DB, real Google).
 * Prisma is not mocked; use real DB and LIVE_* env from .env.test.local.
 *
 * Run: RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts
 * Or:  RUN_LIVE_E2E=true vitest run --config vitest.e2e.config.ts tests/e2e/critical-e2e-*.test.ts
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/generated\//, replacement: path.join(rootDir, "generated/") },
      { find: /^@\/server\//, replacement: path.join(rootDir, "src/server/") },
      { find: /^@\/integrations\//, replacement: path.join(rootDir, "src/server/integrations/") },
      { find: /^@\/features\//, replacement: path.join(rootDir, "src/server/features/") },
      { find: /^@\/actions\//, replacement: path.join(rootDir, "src/server/actions/") },
      { find: /^@\/types\//, replacement: path.join(rootDir, "src/server/types/") },
      { find: /^@\/components\//, replacement: path.join(rootDir, "src/components/") },
      { find: /^@\/shaders\//, replacement: path.join(rootDir, "src/shaders/") },
      { find: /^@\/lib\//, replacement: path.join(rootDir, "src/lib/") },
      { find: /^@\/hooks\//, replacement: path.join(rootDir, "src/hooks/") },
      { find: /^@\/enterprise\//, replacement: path.join(rootDir, "src/enterprise/") },
      { find: /^@\/tests\//, replacement: path.join(rootDir, "tests/") },
      { find: /^@\/(.*)$/, replacement: path.join(rootDir, "src/$1") },
      { find: /^@amodel\//, replacement: path.join(rootDir, "src/server/packages/") },
    ],
  },
  test: {
    environment: "node",
    setupFiles: ["tests/support/e2e.setup.ts"],
    include: ["tests/e2e/**/*.test.ts"],
    passWithNoTests: true,
    // Run E2E test files one after another so Slack tests don't flood the same channel
    fileParallelism: false,
    // beforeEach waits 15s between Slack tests; hook must not time out first
    hookTimeout: 20_000,
  },
});
