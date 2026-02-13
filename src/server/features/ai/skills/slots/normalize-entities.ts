export interface NormalizedEntityResult {
  normalized: Record<string, unknown>;
  unresolved: string[];
}

function toIsoAtHour(base: Date, hour: number): string {
  const d = new Date(base);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

export function normalizeSemanticEntities(params: {
  rawMessage: string;
  entities: Array<{ key: string; value: unknown }>;
  timeZone: string;
}): NormalizedEntityResult {
  const normalized: Record<string, unknown> = {};
  const unresolved: string[] = [];

  for (const entity of params.entities) {
    normalized[entity.key] = entity.value;
  }

  const lower = params.rawMessage.toLowerCase();
  const now = new Date();

  if (!normalized.time_window) {
    if (/\btoday\b/.test(lower)) {
      normalized.time_window = {
        start: toIsoAtHour(now, 0),
        end: toIsoAtHour(now, 23),
        timezone: params.timeZone,
      };
    } else if (/\btomorrow\b/.test(lower)) {
      const tomorrow = new Date(now);
      tomorrow.setDate(now.getDate() + 1);
      normalized.time_window = {
        start: toIsoAtHour(tomorrow, 0),
        end: toIsoAtHour(tomorrow, 23),
        timezone: params.timeZone,
      };
    } else if (/\bthis week\b/.test(lower)) {
      const end = new Date(now);
      end.setDate(now.getDate() + 7);
      normalized.time_window = {
        start: now.toISOString(),
        end: end.toISOString(),
        timezone: params.timeZone,
      };
    }
  }

  if (!normalized.availability_pref) {
    if (/\bmorning\b/.test(lower)) normalized.availability_pref = "morning";
    if (/\bafternoon\b/.test(lower)) normalized.availability_pref = "afternoon";
    if (/\bevening\b/.test(lower)) normalized.availability_pref = "evening";
  }

  if (/that thread|that email|that message/.test(lower) && !normalized.thread_id) {
    unresolved.push("thread_reference_needs_context");
  }
  if (/that meeting|that event/.test(lower) && !normalized.event_id) {
    unresolved.push("event_reference_needs_context");
  }

  return { normalized, unresolved };
}
