import { toZonedTime as toZonedTimeTz, fromZonedTime as fromZonedTimeTz } from "date-fns-tz";

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function differenceInMinutes(a: Date, b: Date) {
  return (a.getTime() - b.getTime()) / (60 * 1000);
}

export function differenceInHours(a: Date, b: Date) {
  return differenceInMinutes(a, b) / 60;
}

export function roundDateUp(date: Date, minutes = 30) {
  const ms = minutes * 60 * 1000;
  return new Date(Math.ceil(date.getTime() / ms) * ms);
}

export function setHours(date: Date, hours: number) {
  const copy = new Date(date);
  copy.setHours(hours);
  return copy;
}

export function setMinutes(date: Date, minutes: number) {
  const copy = new Date(date);
  copy.setMinutes(minutes);
  return copy;
}

export function getDay(date: Date) {
  return date.getDay();
}

export function areIntervalsOverlapping(a: { start: Date; end: Date }, b: { start: Date; end: Date }) {
  return a.start < b.end && b.start < a.end;
}

export function toZonedTime(date: Date, timeZone: string) {
  return toZonedTimeTz(date, timeZone);
}

export function fromZonedTime(date: Date, timeZone: string) {
  return fromZonedTimeTz(date, timeZone);
}

export function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZoneOrUtc(timeZone?: string | null) {
  if (timeZone && isValidTimeZone(timeZone)) {
    return { timeZone, isFallback: false, original: timeZone };
  }
  return { timeZone: "UTC", isFallback: true, original: timeZone ?? null };
}

function isSameLocalTime(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

export function isAmbiguousLocalTime(date: Date, timeZone: string) {
  if (!isValidTimeZone(timeZone)) return false;
  const utc = fromZonedTime(date, timeZone);
  const utcPlusHour = new Date(utc.getTime() + 60 * 60 * 1000);
  const localPlusHour = toZonedTime(utcPlusHour, timeZone);
  return isSameLocalTime(date, localPlusHour);
}
