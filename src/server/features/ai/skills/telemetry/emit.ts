import type { Logger } from "@/server/lib/logger";
import type { SkillTelemetryEvent } from "@/server/features/ai/skills/telemetry/events";

export function emitSkillTelemetry(logger: Logger, event: SkillTelemetryEvent): void {
  // For now: log-only. Replace with PostHog/OpenTelemetry when the runtime is stable.
  logger.info(`[skills-telemetry] ${event.name}`, event);
}
