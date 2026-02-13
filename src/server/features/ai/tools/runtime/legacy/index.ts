import { createCapabilityToolContext } from "@/server/features/ai/tools/runtime/legacy/context";
import { createEmailCapabilities } from "@/server/features/ai/tools/runtime/legacy/email";
import { createCalendarCapabilities } from "@/server/features/ai/tools/runtime/legacy/calendar";
import { createPlannerCapabilities } from "@/server/features/ai/tools/runtime/legacy/planner";
import { createPolicyCapabilities } from "@/server/features/ai/tools/runtime/legacy/policy";
import type { CapabilityRuntimeContext } from "@/server/features/ai/tools/runtime/legacy/types";

export async function createCapabilities(runtime: CapabilityRuntimeContext) {
  const toolContext = await createCapabilityToolContext(runtime);
  const env = { toolContext, runtime };

  return {
    email: createEmailCapabilities(env),
    calendar: createCalendarCapabilities(env),
    planner: createPlannerCapabilities(),
    policy: createPolicyCapabilities(env),
  };
}

export type SkillCapabilities = Awaited<ReturnType<typeof createCapabilities>>;
