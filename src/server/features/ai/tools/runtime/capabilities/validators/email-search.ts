const SUSPICIOUS_FROM_PATTERNS: RegExp[] = [
  /\bconversation\s+memory\b/iu,
  /\bchat\s+history\b/iu,
  /\bour\s+conversation\b/iu,
  /\bthis\s+chat\b/iu,
  /\bprevious\s+messages?\b/iu,
];

const TRAILING_TEMPORAL_SUFFIX_PATTERNS: RegExp[] = [
  /\s+(?:in\s+)?(?:the\s+)?(?:last|past)\s+\d{1,3}\s+(?:day|days|week|weeks|month|months|year|years)\b.*$/iu,
  /\s+(?:today|tonight|tomorrow|yesterday|this\s+week|next\s+week|this\s+month|last\s+month)\b.*$/iu,
];

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
}

function isSuspiciousFromValue(value: string): boolean {
  if (value.length > 120) return true;
  return SUSPICIOUS_FROM_PATTERNS.some((pattern) => pattern.test(value));
}

function stripTrailingTemporalScope(value: string): string {
  return TRAILING_TEMPORAL_SUFFIX_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, "").trim(),
    value,
  );
}

function sanitizeDateRange(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};

  const before = normalizeStringValue(raw.before);
  if (before) next.before = before;

  const after = normalizeStringValue(raw.after);
  if (after) next.after = after;

  const timeZone = normalizeStringValue(raw.timeZone);
  if (timeZone) next.timeZone = timeZone;

  const timezone = normalizeStringValue(raw.timezone);
  if (timezone && !timeZone) next.timezone = timezone;

  return Object.keys(next).length > 0 ? next : undefined;
}

export type EmailSearchFilterValidationResult =
  | {
      ok: true;
      filter: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      message: string;
      prompt: string;
      fields: string[];
    };

export function validateEmailSearchFilter(
  filter: Record<string, unknown>,
): EmailSearchFilterValidationResult {
  const sanitized: Record<string, unknown> = { ...filter };

  const query = normalizeStringValue(filter.query);
  if (query) {
    sanitized.query = query;
  } else {
    delete sanitized.query;
  }

  const text = normalizeStringValue(filter.text);
  if (text) {
    sanitized.text = text;
  } else {
    delete sanitized.text;
  }

  const from = normalizeStringValue(filter.from);
  if (from) {
    const normalizedFrom = stripTrailingTemporalScope(from);
    if (!normalizedFrom) {
      delete sanitized.from;
    } else if (isSuspiciousFromValue(normalizedFrom)) {
      // Convert over-broad sender prose into a soft text hint instead of hard-failing.
      delete sanitized.from;
      if (!normalizeStringValue(sanitized.text)) {
        sanitized.text = normalizedFrom;
      }
    } else {
      sanitized.from = normalizedFrom;
    }
  } else {
    delete sanitized.from;
  }

  const to = normalizeStringValue(filter.to);
  if (to) {
    sanitized.to = to;
  } else {
    delete sanitized.to;
  }

  const dateRange = sanitizeDateRange(filter.dateRange);
  if (dateRange) {
    sanitized.dateRange = dateRange;
  } else {
    delete sanitized.dateRange;
  }

  return {
    ok: true,
    filter: sanitized,
  };
}
