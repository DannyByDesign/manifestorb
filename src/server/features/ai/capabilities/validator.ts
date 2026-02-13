import type { CapabilityName } from "@/server/features/ai/skills/contracts/skill-contract";
import {
  getCapabilityDefinition,
  type CapabilityDefinition,
} from "@/server/features/ai/capabilities/registry";

export interface CapabilityValidationSuccess {
  ok: true;
  definition: CapabilityDefinition;
  normalizedArgs: Record<string, unknown>;
}

export interface CapabilityValidationFailure {
  ok: false;
  definition: CapabilityDefinition;
  errorCode: string;
  message: string;
}

export type CapabilityValidationResult =
  | CapabilityValidationSuccess
  | CapabilityValidationFailure;

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function validateCapabilityArgs(params: {
  capability: CapabilityName;
  args: unknown;
}): CapabilityValidationResult {
  const definition = getCapabilityDefinition(params.capability);
  const parsed = definition.inputSchema.safeParse(toRecord(params.args));

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      definition,
      errorCode: "invalid_capability_args",
      message:
        first?.message ??
        `Arguments for capability ${params.capability} failed validation.`,
    };
  }

  return {
    ok: true,
    definition,
    normalizedArgs: parsed.data as Record<string, unknown>,
  };
}
