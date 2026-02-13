let providerSchemaRegistryValidated = false;

export function ensureProviderSchemaRegistryInitialized(): void {
  if (providerSchemaRegistryValidated) return;
  // Open-world runtime no longer depends on the legacy structured-output
  // schema registry (preflight/router/semantic-parser/planner generations).
  // Tool schemas are validated at tool-fabric assembly time.
  providerSchemaRegistryValidated = true;
}
