import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/generated\//,
        replacement: path.join(rootDir, "generated/"),
      },
      {
        find: /^@\/server\//,
        replacement: path.join(rootDir, "src/server/"),
      },
      {
        find: /^@\/integrations\//,
        replacement: path.join(rootDir, "src/server/integrations/"),
      },
      {
        find: /^@\/features\//,
        replacement: path.join(rootDir, "src/server/features/"),
      },
      {
        find: /^@\/actions\//,
        replacement: path.join(rootDir, "src/server/actions/"),
      },
      {
        find: /^@\/types\//,
        replacement: path.join(rootDir, "src/server/types/"),
      },
      {
        find: /^@\/components\//,
        replacement: path.join(rootDir, "src/components/"),
      },
      {
        find: /^@\/shaders\//,
        replacement: path.join(rootDir, "src/shaders/"),
      },
      {
        find: /^@\/lib\//,
        replacement: path.join(rootDir, "src/lib/"),
      },
      {
        find: /^@\/hooks\//,
        replacement: path.join(rootDir, "src/hooks/"),
      },
      {
        find: /^@\/enterprise\//,
        replacement: path.join(rootDir, "src/enterprise/"),
      },
      {
        find: /^@\/__tests__\//,
        replacement: path.join(rootDir, "src/__tests__/"),
      },
      {
        find: /^@\/(.*)$/,
        replacement: path.join(rootDir, "src/$1"),
      },
      {
        find: /^@amodel\//,
        replacement: path.join(rootDir, "src/server/packages/"),
      },
    ],
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    setupFiles: ["src/__tests__/setup.ts"],
  },
});
