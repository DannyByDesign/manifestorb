import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import { asObject, asStringArray } from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const plannerToolExecutors: RuntimeToolExecutorMap = {
  "planner.composeDayPlan": async ({ args, capabilities }) =>
    capabilities.planner.composeDayPlan({
      topEmailItems: Array.isArray(args.topEmailItems) ? args.topEmailItems : [],
      calendarItems: Array.isArray(args.calendarItems) ? args.calendarItems : [],
      focusSuggestions: asStringArray(args.focusSuggestions),
    }),
  "planner.compileMultiActionPlan": async ({ args, capabilities }) =>
    capabilities.planner.compileMultiActionPlan({
      actions: Array.isArray(args.actions)
        ? args.actions.filter(
            (item): item is Record<string, unknown> =>
              Boolean(item) && typeof item === "object" && !Array.isArray(item),
          )
        : [],
      constraints: args.constraints ? asObject(args.constraints) : undefined,
    }),
};
