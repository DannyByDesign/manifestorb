import type { ToolResult } from "@/server/features/ai/tools/types";

export type CapabilityErrorCode =
  | "auth_error"
  | "permission_denied"
  | "rate_limit"
  | "not_found"
  | "invalid_input"
  | "unsupported"
  | "transient"
  | "conflict"
  | "unknown";

export interface CapabilityError {
  code: CapabilityErrorCode;
  message: string;
}

function normalizeMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown capability error";
}

export function classifyCapabilityError(error: unknown): CapabilityError {
  const message = normalizeMessage(error);
  const lower = message.toLowerCase();

  if (
    lower.includes("invalid_grant") ||
    lower.includes("reconnect") ||
    lower.includes("refresh token") ||
    lower.includes("unauthorized")
  ) {
    return { code: "auth_error", message };
  }
  if (lower.includes("permission") || lower.includes("forbidden")) {
    return { code: "permission_denied", message };
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return { code: "rate_limit", message };
  }
  if (lower.includes("not found") || lower.includes("missing")) {
    return { code: "not_found", message };
  }
  if (lower.includes("invalid") || lower.includes("must be")) {
    return { code: "invalid_input", message };
  }
  if (lower.includes("not supported") || lower.includes("unsupported")) {
    return { code: "unsupported", message };
  }
  if (
    lower.includes("timeout") ||
    lower.includes("temporar") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset")
  ) {
    return { code: "transient", message };
  }
  if (lower.includes("conflict") || lower.includes("already exists")) {
    return { code: "conflict", message };
  }
  return { code: "unknown", message };
}

export function capabilityFailureResult(
  error: unknown,
  fallbackMessage: string,
  meta?: ToolResult["meta"],
): ToolResult {
  const classified = classifyCapabilityError(error);
  return {
    success: false,
    error: `${classified.code}:${classified.message}`,
    message: fallbackMessage,
    meta,
  };
}
