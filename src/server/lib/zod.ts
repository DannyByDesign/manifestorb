import { z } from "zod";

// Parses boolean env vars consistently.
// Truthy: "true", "1", "yes", "on"
// Falsy: "false", "0", "no", "off"
// Empty/unset: undefined (so schema defaults can apply)
export const booleanString = z.preprocess((val) => {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "boolean") return val;
  const normalized = String(val).trim().toLowerCase();
  if (!normalized) return undefined;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return undefined;
}, z.boolean().optional());

/**
 * Preprocessor for Zod schemas to gracefully handle string inputs
 * that represent boolean values (e.g., "true", "yes", "false", "no").
 * Converts these strings to booleans before validation.
 * Passes through actual booleans or other types for Zod's default handling.
 */
export const preprocessBooleanLike = (val: unknown): unknown => {
  if (typeof val === "string") {
    const lowerVal = val.toLowerCase().trim();
    if (lowerVal === "true" || lowerVal === "yes") return true;
    if (lowerVal === "false" || lowerVal === "no") return false;
  }
  return val;
};
