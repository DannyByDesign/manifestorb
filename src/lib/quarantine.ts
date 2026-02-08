type QuarantineRule = {
  prefix: string;
  reason: string;
};

const DEFAULT_API_QUARANTINE_RULES: QuarantineRule[] = [
  {
    prefix: "/api/ai/analyze-sender-pattern",
    reason: "Legacy sender-pattern endpoint; replaced by conversational tools.",
  },
  {
    prefix: "/api/ai/compose-autocomplete",
    reason: "Legacy compose autocomplete endpoint; not part of core assistant loop.",
  },
  {
    prefix: "/api/ai/digest",
    reason: "Digest pipeline is non-core for launch trust/reliability focus.",
  },
  {
    prefix: "/api/ai/summarise",
    reason: "Legacy summarise endpoint; superseded by unified assistant tools.",
  },
  {
    prefix: "/api/clean",
    reason: "Bulk cleaner workflows are quarantined until core assistant stabilizes.",
  },
  {
    prefix: "/api/debug",
    reason: "Debug endpoints are quarantined in production-facing runtime.",
  },
  {
    prefix: "/api/resend",
    reason: "Digest/summary resend endpoints are non-core for launch scope.",
  },
  {
    prefix: "/api/outlook",
    reason: "Microsoft surfaces are staged for post-launch rollout.",
  },
  {
    prefix: "/api/jobs/cleanup-expired-rules",
    reason: "Legacy rule cleanup job is quarantined during core scope hardening.",
  },
  {
    prefix: "/api/jobs/purge-history",
    reason: "History purge workflow is quarantined pending privacy-policy redesign.",
  },
  {
    prefix: "/api/jobs/summarize-conversation",
    reason: "Legacy summarize job replaced by record-memory pipeline.",
  },
];

const DEFAULT_PAGE_QUARANTINE_RULES: QuarantineRule[] = [];

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildRules(defaults: QuarantineRule[], overrides: string[]): QuarantineRule[] {
  if (overrides.length === 0) return defaults;
  return overrides.map((prefix) => ({
    prefix,
    reason: "Configured via runtime quarantine override.",
  }));
}

export function isRuntimeQuarantineEnabled(): boolean {
  const value = process.env.AMODEL_ENABLE_QUARANTINE;
  if (value === "0" || value === "false") return false;
  return true;
}

export function getApiQuarantineRules(): QuarantineRule[] {
  return buildRules(
    DEFAULT_API_QUARANTINE_RULES,
    parseCsv(process.env.AMODEL_QUARANTINE_API_PREFIXES),
  );
}

export function getPageQuarantineRules(): QuarantineRule[] {
  return buildRules(
    DEFAULT_PAGE_QUARANTINE_RULES,
    parseCsv(process.env.AMODEL_QUARANTINE_PAGE_PREFIXES),
  );
}

export function matchQuarantinedPath(pathname: string): QuarantineRule | null {
  if (!isRuntimeQuarantineEnabled()) return null;

  const rules = pathname.startsWith("/api/")
    ? getApiQuarantineRules()
    : getPageQuarantineRules();

  for (const rule of rules) {
    if (pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)) {
      return rule;
    }
  }

  return null;
}

