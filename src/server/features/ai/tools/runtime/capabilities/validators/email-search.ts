function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : undefined;
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

function sanitizeBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeSort(
  value: unknown,
): "relevance" | "newest" | "oldest" | undefined {
  if (value !== "relevance" && value !== "newest" && value !== "oldest") {
    return undefined;
  }
  return value;
}

function sanitizeCategory(
  value: unknown,
): "primary" | "promotions" | "social" | "updates" | "forums" | undefined {
  if (
    value !== "primary" &&
    value !== "promotions" &&
    value !== "social" &&
    value !== "updates" &&
    value !== "forums"
  ) {
    return undefined;
  }
  return value;
}

function sanitizeStringArray(value: unknown, max = 20): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, max);
  return out.length > 0 ? out : undefined;
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
      fields?: string[];
      clarificationKind?: "invalid_fields" | "concept_definition_required";
      concept?: {
        field: "from" | "to" | "cc";
        value: string;
      };
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
    sanitized.from = from;
  } else {
    delete sanitized.from;
  }

  const to = normalizeStringValue(filter.to);
  if (to) {
    sanitized.to = to;
  } else {
    delete sanitized.to;
  }

  const cc = normalizeStringValue(filter.cc);
  if (cc) {
    sanitized.cc = cc;
  } else {
    delete sanitized.cc;
  }

  const fromConcept = normalizeStringValue(filter.fromConcept);
  if (fromConcept) {
    sanitized.fromConcept = fromConcept;
  } else {
    delete sanitized.fromConcept;
  }

  const toConcept = normalizeStringValue(filter.toConcept);
  if (toConcept) {
    sanitized.toConcept = toConcept;
  } else {
    delete sanitized.toConcept;
  }

  const ccConcept = normalizeStringValue(filter.ccConcept);
  if (ccConcept) {
    sanitized.ccConcept = ccConcept;
  } else {
    delete sanitized.ccConcept;
  }

  const fromEmails = sanitizeStringArray(filter.fromEmails, 50);
  if (fromEmails) {
    sanitized.fromEmails = fromEmails;
  } else {
    delete sanitized.fromEmails;
  }

  const fromDomains = sanitizeStringArray(filter.fromDomains, 50);
  if (fromDomains) {
    sanitized.fromDomains = fromDomains;
  } else {
    delete sanitized.fromDomains;
  }

  const toEmails = sanitizeStringArray(filter.toEmails, 50);
  if (toEmails) {
    sanitized.toEmails = toEmails;
  } else {
    delete sanitized.toEmails;
  }

  const toDomains = sanitizeStringArray(filter.toDomains, 50);
  if (toDomains) {
    sanitized.toDomains = toDomains;
  } else {
    delete sanitized.toDomains;
  }

  const ccEmails = sanitizeStringArray(filter.ccEmails, 50);
  if (ccEmails) {
    sanitized.ccEmails = ccEmails;
  } else {
    delete sanitized.ccEmails;
  }

  const ccDomains = sanitizeStringArray(filter.ccDomains, 50);
  if (ccDomains) {
    sanitized.ccDomains = ccDomains;
  } else {
    delete sanitized.ccDomains;
  }

  const category = sanitizeCategory(filter.category);
  if (category) {
    sanitized.category = category;
  } else {
    delete sanitized.category;
  }

  const dateRange = sanitizeDateRange(filter.dateRange);
  if (dateRange) {
    sanitized.dateRange = dateRange;
  } else {
    delete sanitized.dateRange;
  }

  const hasAttachment = sanitizeBoolean(filter.hasAttachment);
  if (typeof hasAttachment === "boolean") {
    sanitized.hasAttachment = hasAttachment;
  } else {
    delete sanitized.hasAttachment;
  }

  const unread = sanitizeBoolean(filter.unread);
  if (typeof unread === "boolean") {
    sanitized.unread = unread;
  } else {
    delete sanitized.unread;
  }

  const sort = sanitizeSort(filter.sort);
  if (sort) {
    sanitized.sort = sort;
  } else {
    delete sanitized.sort;
  }

  const attachmentMimeTypes = sanitizeStringArray(filter.attachmentMimeTypes, 20);
  if (attachmentMimeTypes) {
    sanitized.attachmentMimeTypes = attachmentMimeTypes;
  } else {
    delete sanitized.attachmentMimeTypes;
  }

  const attachmentFilenameContains = normalizeStringValue(filter.attachmentFilenameContains);
  if (attachmentFilenameContains) {
    sanitized.attachmentFilenameContains = attachmentFilenameContains;
  } else {
    delete sanitized.attachmentFilenameContains;
  }

  const unrepliedToSent = sanitizeBoolean(filter.unrepliedToSent);
  if (typeof unrepliedToSent === "boolean") {
    sanitized.unrepliedToSent = unrepliedToSent;
  } else {
    delete sanitized.unrepliedToSent;
  }

  return {
    ok: true,
    filter: sanitized,
  };
}
