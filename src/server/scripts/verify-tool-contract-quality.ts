import { listToolDefinitions } from "@/server/features/ai/tools/runtime/capabilities/registry";

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length;
}

function main() {
  const definitions = listToolDefinitions();
  const failures: string[] = [];

  for (const definition of definitions) {
    const description = definition.description ?? "";
    const words = countWords(description);
    if (words < 18) {
      failures.push(`${definition.id}:description_too_short:${words}`);
    }
    if (!description.includes("Primary intents:")) {
      failures.push(`${definition.id}:missing_primary_intents_clause`);
    }
    if (!description.includes("Effects:")) {
      failures.push(`${definition.id}:missing_effects_clause`);
    }
    if (!description.includes("Approval operation:")) {
      failures.push(`${definition.id}:missing_approval_clause`);
    }
    if (definition.readOnly && !description.includes("read-only")) {
      failures.push(`${definition.id}:missing_read_only_clause`);
    }
    if (!definition.readOnly && !description.includes("changes user state")) {
      failures.push(`${definition.id}:missing_mutation_clause`);
    }
  }

  if (failures.length > 0) {
    console.error("Tool contract quality check failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Tool contract quality check passed for ${definitions.length} tools.`);
}

main();
