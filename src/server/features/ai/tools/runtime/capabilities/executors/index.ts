import type { ToolName } from "@/server/features/ai/tools/runtime/capabilities/registry";
import { calendarToolExecutors } from "@/server/features/ai/tools/runtime/capabilities/executors/calendar";
import { emailToolExecutors } from "@/server/features/ai/tools/runtime/capabilities/executors/email";
import { plannerToolExecutors } from "@/server/features/ai/tools/runtime/capabilities/executors/planner";
import { policyToolExecutors } from "@/server/features/ai/tools/runtime/capabilities/executors/policy";
import type {
  RuntimeToolExecutor,
  RuntimeToolExecutorMap,
} from "@/server/features/ai/tools/runtime/capabilities/executors/types";

const runtimeToolExecutors: RuntimeToolExecutorMap = {
  ...emailToolExecutors,
  ...calendarToolExecutors,
  ...plannerToolExecutors,
  ...policyToolExecutors,
};

export function resolveRuntimeToolExecutor(toolName: ToolName): RuntimeToolExecutor {
  const executor = runtimeToolExecutors[toolName];
  if (!executor) {
    throw new Error(`missing_runtime_tool_executor:${toolName}`);
  }
  return executor;
}
