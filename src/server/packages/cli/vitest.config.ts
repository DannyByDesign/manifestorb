import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use threads pool for cleaner exit
    pool: "threads",
    // @ts-expect-error - version mismatch
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
