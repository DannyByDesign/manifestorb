import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import { asString } from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const memoryToolExecutors: RuntimeToolExecutorMap = {
  "memory.remember": async ({ args, capabilities }) =>
    capabilities.memory.remember({
      key: asString(args.key) ?? "",
      value: asString(args.value) ?? "",
      confidence: typeof args.confidence === "number" ? args.confidence : undefined,
    }),
  "memory.recall": async ({ args, capabilities }) =>
    capabilities.memory.recall({
      query: asString(args.query) ?? "",
      limit: typeof args.limit === "number" ? args.limit : undefined,
      minScore: typeof args.minScore === "number" ? args.minScore : undefined,
    }),
  "memory.forget": async ({ args, capabilities }) =>
    capabilities.memory.forget(asString(args.key) ?? ""),
  "memory.list": async ({ args, capabilities }) =>
    capabilities.memory.list(typeof args.limit === "number" ? args.limit : undefined),
};
