import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

type BoundKind = "start" | "end";

export function hasExplicitTimeZone(value: string): boolean {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/u.test(value);
}

function toLocalDateFromParts(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  millisecond: number,
): Date {
  // Creates a wall-clock local date with exact components.
  return new Date(year, month - 1, day, hour, minute, second, millisecond);
}

export function parseDateBoundInTimeZone(
  value: string | undefined,
  timeZone: string,
  kind: BoundKind = "start",
): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (hasExplicitTimeZone(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const dateOnly = trimmed.match(DATE_ONLY_PATTERN);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const localDate = toLocalDateFromParts(
      year,
      month,
      day,
      kind === "start" ? 0 : 23,
      kind === "start" ? 0 : 59,
      kind === "start" ? 0 : 59,
      kind === "start" ? 0 : 999,
    );
    return fromZonedTime(localDate, timeZone);
  }

  const localDateTime = trimmed.match(LOCAL_DATE_TIME_PATTERN);
  if (localDateTime) {
    const year = Number(localDateTime[1]);
    const month = Number(localDateTime[2]);
    const day = Number(localDateTime[3]);
    const hour = Number(localDateTime[4]);
    const minute = Number(localDateTime[5]);
    const second = localDateTime[6] ? Number(localDateTime[6]) : 0;
    const millisecond = localDateTime[7]
      ? Number(localDateTime[7].padEnd(3, "0").slice(0, 3))
      : 0;
    const localDate = toLocalDateFromParts(
      year,
      month,
      day,
      hour,
      minute,
      second,
      millisecond,
    );
    return fromZonedTime(localDate, timeZone);
  }

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function parseLocalDateTimeInput(
  value: string | undefined,
): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || hasExplicitTimeZone(trimmed)) return null;
  const localDateTime = trimmed.match(LOCAL_DATE_TIME_PATTERN);
  if (!localDateTime) return null;

  const year = Number(localDateTime[1]);
  const month = Number(localDateTime[2]);
  const day = Number(localDateTime[3]);
  const hour = Number(localDateTime[4]);
  const minute = Number(localDateTime[5]);
  const second = localDateTime[6] ? Number(localDateTime[6]) : 0;
  const millisecond = localDateTime[7]
    ? Number(localDateTime[7].padEnd(3, "0").slice(0, 3))
    : 0;
  return toLocalDateFromParts(
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
  );
}

export function formatDateTimeForUser(date: Date, timeZone: string): string {
  return formatInTimeZone(date, timeZone, "EEE, MMM d, h:mm a zzz");
}
