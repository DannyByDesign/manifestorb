import "@/server/features/ai/orchestration/preflight";
import "@/server/features/ai/skills/router/parse-request";
import "@/server/features/ai/skills/router/route-skill";
import "@/server/features/ai/skills/slots/resolve-slots";
import "@/server/features/ai/planner/build-plan";
import "@/server/features/ai/planner/repair-plan";
import { validateProviderSchemaRegistry } from "@/server/lib/llms/schema-safety";

const REQUIRED_PROVIDER_SCHEMA_IDS = [
  "orchestration_preflight_v2",
  "skills_semantic_parser_v2",
  "skills_router_closed_set_v1",
  "skills_slots_v1",
  "capability_planner_v2",
  "capability_planner_repair_v2",
] as const;

let providerSchemaRegistryValidated = false;

export function ensureProviderSchemaRegistryInitialized(): void {
  if (providerSchemaRegistryValidated) return;
  validateProviderSchemaRegistry({
    expectedSchemaIds: [...REQUIRED_PROVIDER_SCHEMA_IDS],
  });
  providerSchemaRegistryValidated = true;
}
