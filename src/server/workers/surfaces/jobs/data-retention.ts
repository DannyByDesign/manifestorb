import { applyOperationalRetentionPolicies } from "@/server/features/data-retention/service";

export async function runDataRetentionSweep(): Promise<void> {
  const result = await applyOperationalRetentionPolicies();
  console.log("[Scheduler] Data retention completed", result);
}
