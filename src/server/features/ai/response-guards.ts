export function claimsDraftWasCreated(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/i(?:'|’)ve\s+(?:already\s+)?drafted\b/u.test(normalized)) return true;
  if (/\bi\s+(?:already\s+)?drafted\b/u.test(normalized)) return true;
  if (/created\s+(?:a\s+)?draft\b/u.test(normalized)) return true;
  if (/draft\s+(?:is\s+)?ready\b/u.test(normalized)) return true;
  if (/saved\s+to\s+(?:your\s+)?drafts\b/u.test(normalized)) return true;
  return false;
}
