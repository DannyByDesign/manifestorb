export function buildSlotClarificationPrompt(missing: string[]): string | undefined {
  if (missing.length === 0) return undefined;
  const primary = missing[0];
  if (missing.length === 1) {
    if (primary === "participants") return "Who should be included? You can paste one or more emails.";
    if (primary === "duration") return "How long should it be (e.g. 30 min or 1 hour)?";
    if (primary.includes("time_window") || primary.includes("date_window")) {
      return "What time window should I use (today, this week, or a specific range)?";
    }
    return `I need one detail to continue: ${primary}.`;
  }
  return `I need a few details to continue: ${missing.join(", ")}.`;
}

