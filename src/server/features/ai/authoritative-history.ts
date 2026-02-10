export function normalizeAuthoritativeHistory(
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(history) || history.length === 0) return [];

  const MAX_MESSAGES = 40;
  const MAX_CHARS = 20_000;
  let totalChars = 0;
  const normalized: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const message of history.slice(-MAX_MESSAGES)) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }
    if (typeof message.content !== "string") continue;
    const content = message.content.trim();
    if (!content) continue;
    if (totalChars + content.length > MAX_CHARS) break;
    totalChars += content.length;
    normalized.push({
      role: message.role,
      content,
    });
  }

  return normalized;
}
