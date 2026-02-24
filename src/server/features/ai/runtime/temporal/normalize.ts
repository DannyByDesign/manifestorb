import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  resolveCalendarTimeZoneForRequest,
  resolveDefaultCalendarTimeZone,
} from "@/server/features/ai/tools/calendar-time";
import { parseDateBoundInTimeZone } from "@/server/features/ai/tools/timezone";
import {
  temporalSourceSchema,
  type TemporalDefaultWindow,
  type TemporalSource,
} from "@/server/features/ai/runtime/temporal/schema";

export type NormalizedTemporalRange =
  | {
      ok: true;
      timeZone: string;
      start?: Date;
      end?: Date;
      source: "explicit" | "relative" | "default" | "none";
    }
  | {
      ok: false;
      error: string;
    };

function localWithTime(
  local: Date,
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
): Date {
  const out = new Date(local);
  out.setHours(hours, minutes, seconds, milliseconds);
  return out;
}

function addLocalDays(local: Date, days: number): Date {
  const out = new Date(local);
  out.setDate(out.getDate() + days);
  return out;
}

function inferRelativeRange(text: string | undefined, timeZone: string): {
  start: Date;
  end: Date;
} | null {
  if (!text || text.trim().length === 0) return null;
  const normalized = text.toLowerCase();
  const nowLocal = toZonedTime(new Date(), timeZone);

  if (/\bthis morning\b/u.test(normalized)) {
    return {
      start: fromZonedTime(localWithTime(nowLocal, 6, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(nowLocal, 11, 59, 59, 999), timeZone),
    };
  }
  if (/\bthis afternoon\b/u.test(normalized)) {
    return {
      start: fromZonedTime(localWithTime(nowLocal, 12, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(nowLocal, 17, 59, 59, 999), timeZone),
    };
  }
  if (/\b(tonight|this evening)\b/u.test(normalized)) {
    return {
      start: fromZonedTime(localWithTime(nowLocal, 18, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(nowLocal, 23, 59, 59, 999), timeZone),
    };
  }
  if (/\b(today|right now|now)\b/u.test(normalized)) {
    return {
      start: fromZonedTime(localWithTime(nowLocal, 0, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(nowLocal, 23, 59, 59, 999), timeZone),
    };
  }
  if (/\btomorrow\b/u.test(normalized)) {
    const tomorrow = addLocalDays(nowLocal, 1);
    return {
      start: fromZonedTime(localWithTime(tomorrow, 0, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(tomorrow, 23, 59, 59, 999), timeZone),
    };
  }
  if (/\byesterday\b/u.test(normalized)) {
    const yesterday = addLocalDays(nowLocal, -1);
    return {
      start: fromZonedTime(localWithTime(yesterday, 0, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(yesterday, 23, 59, 59, 999), timeZone),
    };
  }
  if (/\bthis week\b/u.test(normalized)) {
    const startLocal = addLocalDays(nowLocal, -nowLocal.getDay());
    const endLocal = addLocalDays(startLocal, 6);
    return {
      start: fromZonedTime(localWithTime(startLocal, 0, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(endLocal, 23, 59, 59, 999), timeZone),
    };
  }
  if (/\bnext week\b/u.test(normalized)) {
    const startOfThisWeek = addLocalDays(nowLocal, -nowLocal.getDay());
    const startLocal = addLocalDays(startOfThisWeek, 7);
    const endLocal = addLocalDays(startLocal, 6);
    return {
      start: fromZonedTime(localWithTime(startLocal, 0, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(endLocal, 23, 59, 59, 999), timeZone),
    };
  }

  return null;
}

function readTemporalBounds(source: TemporalSource): {
  after?: string;
  before?: string;
} {
  const nested =
    source.dateRange && typeof source.dateRange === "object"
      ? source.dateRange
      : undefined;
  const after = nested?.after ?? source.after;
  const before = nested?.before ?? source.before;
  return { after, before };
}

function resolveRequestedTimeZone(source: TemporalSource): string | undefined {
  const nested =
    source.dateRange && typeof source.dateRange === "object"
      ? source.dateRange
      : undefined;
  return nested?.timeZone ?? nested?.timezone ?? source.timeZone ?? source.timezone;
}

function resolveReferenceText(source: TemporalSource): string | undefined {
  return source.referenceText ?? source.query ?? source.text;
}

function defaultWindowRange(defaultWindow: TemporalDefaultWindow, timeZone: string): {
  start: Date;
  end: Date;
} {
  const nowLocal = toZonedTime(new Date(), timeZone);
  if (defaultWindow === "today") {
    return {
      start: fromZonedTime(localWithTime(nowLocal, 0, 0, 0, 0), timeZone),
      end: fromZonedTime(localWithTime(nowLocal, 23, 59, 59, 999), timeZone),
    };
  }
  const start = new Date();
  return {
    start,
    end: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1_000),
  };
}

export async function normalizeTemporalRange(params: {
  userId: string;
  emailAccountId: string;
  source: Record<string, unknown>;
  defaultWindow: TemporalDefaultWindow;
  missingBoundDurationMs: number;
}): Promise<NormalizedTemporalRange> {
  const parsed = temporalSourceSchema.safeParse(params.source);
  if (!parsed.success) {
    return {
      ok: false,
      error: "Invalid temporal payload.",
    };
  }

  const source = parsed.data;
  const defaultTimeZone = await resolveDefaultCalendarTimeZone({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
  });
  if ("error" in defaultTimeZone) {
    return {
      ok: false,
      error: defaultTimeZone.error,
    };
  }
  const resolvedTimeZone = resolveCalendarTimeZoneForRequest({
    requestedTimeZone: resolveRequestedTimeZone(source),
    defaultTimeZone: defaultTimeZone.timeZone,
  });
  if ("error" in resolvedTimeZone) {
    return {
      ok: false,
      error: resolvedTimeZone.error,
    };
  }
  const timeZone = resolvedTimeZone.timeZone;
  const { after, before } = readTemporalBounds(source);
  const afterParsed = after
    ? parseDateBoundInTimeZone(after, timeZone, "start")
    : null;
  if (after && !afterParsed) {
    return {
      ok: false,
      error: `Invalid start datetime "${after}". Use ISO-8601 or local datetime.`,
    };
  }
  const beforeParsed = before
    ? parseDateBoundInTimeZone(before, timeZone, "end")
    : null;
  if (before && !beforeParsed) {
    return {
      ok: false,
      error: `Invalid end datetime "${before}". Use ISO-8601 or local datetime.`,
    };
  }

  if (afterParsed || beforeParsed) {
    const start =
      afterParsed ??
      new Date(beforeParsed!.getTime() - params.missingBoundDurationMs);
    const end =
      beforeParsed ??
      new Date(afterParsed!.getTime() + params.missingBoundDurationMs);
    if (start.getTime() > end.getTime()) {
      return {
        ok: false,
        error: "Invalid date range: start must be before end.",
      };
    }
    return {
      ok: true,
      source: "explicit",
      timeZone,
      start,
      end,
    };
  }

  const relative = inferRelativeRange(resolveReferenceText(source), timeZone);
  if (relative) {
    return {
      ok: true,
      source: "relative",
      timeZone,
      start: relative.start,
      end: relative.end,
    };
  }

  if (params.defaultWindow === "none") {
    return {
      ok: true,
      source: "none",
      timeZone,
    };
  }

  const fallbackRange = defaultWindowRange(params.defaultWindow, timeZone);
  return {
    ok: true,
    source: "default",
    timeZone,
    start: fallbackRange.start,
    end: fallbackRange.end,
  };
}
