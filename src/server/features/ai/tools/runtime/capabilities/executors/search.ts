import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import { asObject } from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const searchToolExecutors: RuntimeToolExecutorMap = {
  "search.query": async ({ args, capabilities }) =>
    capabilities.search.query(asObject(args)),
};
