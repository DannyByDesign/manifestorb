import { createCapabilityToolContext } from "@/server/features/ai/capabilities/context";
import { createEmailCapabilities } from "@/server/features/ai/capabilities/email";
import { createCalendarCapabilities } from "@/server/features/ai/capabilities/calendar";
import { createPlannerCapabilities } from "@/server/features/ai/capabilities/planner";
import { createPolicyCapabilities } from "@/server/features/ai/capabilities/policy";
import type { CapabilityRuntimeContext } from "@/server/features/ai/capabilities/types";

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
