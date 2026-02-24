export function claimsDraftWasCreated(text: string): boolean {
  const normalized = text.toLowerCase();
  const apostropheNormalized = normalized.replaceAll("’", "'");
  if (apostropheNormalized.includes("i've drafted")) return true;
  if (apostropheNormalized.includes("i've already drafted")) return true;
  if (apostropheNormalized.includes("i drafted")) return true;
  if (apostropheNormalized.includes("i already drafted")) return true;
  if (normalized.includes("created draft") || normalized.includes("created a draft")) return true;
  if (normalized.includes("draft is ready") || normalized.includes("draft ready")) return true;
  if (normalized.includes("saved to drafts") || normalized.includes("saved to your drafts")) return true;
  return false;
}
