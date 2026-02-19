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
      failed?.error ||
      "I couldn't complete that request with the available tools yet."
    );
  }

  const itemCount = successful
    .map((result) => extractList(result.data).length)
    .find((count) => count > 0);
  if (itemCount && itemCount > 0) {
    return `Found ${itemCount} item${itemCount === 1 ? "" : "s"}.`;
  }

  return "Completed the request.";
}
