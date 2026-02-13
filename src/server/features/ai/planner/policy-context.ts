import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import { mapCapabilityToPolicyContext } from "@/server/features/ai/policy/capability-context";

export function mapPlannerCapabilityToApprovalContext(params: {
  capability: CapabilityName;
  args: Record<string, unknown>;
}): {
  toolName: string;
  args: Record<string, unknown>;
} {
  return mapCapabilityToPolicyContext({
    capability: params.capability,
    args: params.args,
  });
}
