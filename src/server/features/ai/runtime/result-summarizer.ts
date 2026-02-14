import type { RuntimeToolResult } from "@/server/features/ai/tools/contracts/tool-result";

function extractList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.messages)) return record.messages;
  if (Array.isArray(record.events)) return record.events;
  if (Array.isArray(record.slots)) return record.slots;
  return [];
}

function summarizeItem(item: unknown): string {
  if (!item || typeof item !== "object") return String(item);
  const record = item as Record<string, unknown>;
  const subject =
    typeof record.subject === "string"
      ? record.subject
      : typeof record.title === "string"
        ? record.title
        : undefined;
  const from = typeof record.from === "string" ? record.from : undefined;
  const when =
    typeof record.date === "string"
      ? record.date
      : typeof record.start === "string"
        ? record.start
        : undefined;

  if (!subject && !from && !when) return "details unavailable";
  if (subject && from && when) return `from ${from} — "${subject}" (${when})`;
  if (subject && from) return `from ${from} — "${subject}"`;
  if (subject && when) return `"${subject}" (${when})`;
  if (from && when) return `from ${from} (${when})`;
  if (subject) return `"${subject}"`;
  if (from) return `from ${from}`;
  return `${when}`;
}

function itemTimestampMs(item: unknown): number | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const candidates = [
    record.date,
    record.start,
    record.receivedAt,
    record.updatedAt,
    record.createdAt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.trim().length === 0) continue;
    const parsed = Date.parse(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function pickMostRecentItem(items: unknown[]): unknown {
  let selected = items[0];
  let selectedMs = itemTimestampMs(selected) ?? Number.NEGATIVE_INFINITY;

  for (let i = 1; i < items.length; i += 1) {
    const candidate = items[i];
    const candidateMs = itemTimestampMs(candidate) ?? Number.NEGATIVE_INFINITY;
    if (candidateMs > selectedMs) {
      selected = candidate;
      selectedMs = candidateMs;
    }
  }

  return selected;
}

export function summarizeRuntimeResults(params: {
  request: string;
  results: RuntimeToolResult[];
  approvalsCount: number;
}): string {
  const successful = params.results.filter((result) => result.success);
  if (successful.length === 0) {
    if (params.approvalsCount > 0) {
      return "I created approval requests for restricted actions. Approve them and I can continue.";
    }
    const failed = params.results[params.results.length - 1];
    return (
      failed?.message ||
      failed?.error ||
      "I couldn't complete that request with the available tools yet."
    );
  }

  const normalized = params.request.toLowerCase();
  const wantsFirst = /\b(first|1st|top)\b/u.test(normalized);
  const wantsLast = /\b(last|latest|most recent)\b/u.test(normalized);

  if (wantsFirst || wantsLast) {
    for (const result of successful) {
      const items = extractList(result.data);
      if (items.length === 0) continue;
      if (wantsLast) {
        const selected = pickMostRecentItem(items);
        return `Your most recent item is ${summarizeItem(selected)}.`;
      }
      const selected = items[0];
      return `The first item is ${summarizeItem(selected)}.`;
    }
  }

  const latest = successful[successful.length - 1];
  if (latest?.message && latest.message.trim().length > 0) {
    return latest.message.trim();
  }

  const itemCount = successful
    .map((result) => extractList(result.data).length)
    .find((count) => count > 0);
  if (itemCount && itemCount > 0) {
    return `Found ${itemCount} item${itemCount === 1 ? "" : "s"}.`;
  }

  return "Completed the request.";
}
