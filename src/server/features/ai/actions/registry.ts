/**
 * Action registry: register and look up action definitions by type.
 * Enables adding new actions without schema migration.
 */
import type { EmailProvider } from "@/features/email/types";
import type { Logger } from "@/server/lib/logger";
import type { ExecutedRule } from "@/generated/prisma/client";
import type { EmailForAction } from "@/features/ai/types";

export interface ActionFunctionOptions {
  client: EmailProvider;
  email: EmailForAction;
  args: Record<string, unknown>;
  userEmail: string;
  userId: string;
  emailAccountId: string;
  executedRule: ExecutedRule;
  logger: Logger;
}

export interface ActionDefinition {
  type: string;
  name: string;
  description: string;
  inputFields: string[];
  execute: (opts: ActionFunctionOptions) => Promise<unknown>;
  availableForRules: boolean;
  triggerPatterns: string[];
}

const registry = new Map<string, ActionDefinition>();

export function registerAction(definition: ActionDefinition): void {
  if (registry.has(definition.type)) {
    throw new Error(`Action type "${definition.type}" is already registered`);
  }
  registry.set(definition.type, definition);
}

export function getAction(type: string): ActionDefinition | undefined {
  return registry.get(type);
}

export function getAllActions(): ActionDefinition[] {
  return Array.from(registry.values());
}

export function getRuleActions(): ActionDefinition[] {
  return getAllActions().filter((a) => a.availableForRules);
}

export function getActionTriggerGuidance(): string {
  return getRuleActions()
    .map(
      (a) =>
        `- ${a.type}: ${a.description}. Trigger patterns: ${a.triggerPatterns.join(", ")}`,
    )
    .join("\n");
}
