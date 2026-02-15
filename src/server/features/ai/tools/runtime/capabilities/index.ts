import { createCapabilityToolContext } from "@/server/features/ai/tools/runtime/capabilities/context";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/capabilities/email";
import { createCalendarCapabilities } from "@/server/features/ai/tools/runtime/capabilities/calendar";
import { createPlannerCapabilities } from "@/server/features/ai/tools/runtime/capabilities/planner";
import { createPolicyCapabilities } from "@/server/features/ai/tools/runtime/capabilities/policy";
import { createTaskCapabilities } from "@/server/features/ai/tools/runtime/capabilities/task";
import type { CapabilityRuntimeContext } from "@/server/features/ai/tools/runtime/capabilities/types";

export async function createCapabilities(runtime: CapabilityRuntimeContext) {
  const toolContext = await createCapabilityToolContext(runtime);
  const env = { toolContext, runtime };

  return {
    email: createEmailCapabilities(env),
    calendar: createCalendarCapabilities(env),
    task: createTaskCapabilities(env),
    planner: createPlannerCapabilities(),
    policy: createPolicyCapabilities(env),
  };
}

export type SkillCapabilities = Awaited<ReturnType<typeof createCapabilities>>;
