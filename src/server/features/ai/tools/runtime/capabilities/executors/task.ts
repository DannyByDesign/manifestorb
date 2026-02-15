import type { RuntimeToolExecutorMap } from "@/server/features/ai/tools/runtime/capabilities/executors/types";
import { asObject, asString } from "@/server/features/ai/tools/runtime/capabilities/executors/utils";

export const taskToolExecutors: RuntimeToolExecutorMap = {
  "task.reschedule": async ({ args, capabilities }) =>
    capabilities.task.reschedule({
      taskId: asString(args.taskId),
      taskTitle: asString(args.taskTitle) ?? asString(args.title) ?? asString(args.query),
      changes: asObject(args.changes),
    }),
};
