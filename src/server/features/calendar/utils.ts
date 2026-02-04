export function toDateOnly(date: Date) {
  return date.toISOString().split("T")[0];
}

export function normalizeRecurrenceRule(rule?: string) {
  if (!rule) return undefined;
  return rule.startsWith("RRULE:") ? rule : `RRULE:${rule}`;
}

export function startOfYear(year: number) {
  return new Date(Date.UTC(year, 0, 1, 0, 0, 0));
}
