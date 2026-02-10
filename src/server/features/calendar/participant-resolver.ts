import prisma from "@/server/db/client";
import { extractEmailAddress, extractEmailAddresses } from "@/server/lib/email";

const TEAM_LIKE_TERMS = [
  "team",
  "my team",
  "the team",
  "everyone",
  "all hands",
  "group",
  "crew",
  "folks",
  "staff",
  "squad",
];

const PARTICIPANT_TRAILING_DELIMITERS = [
  " next ",
  " tomorrow",
  " today",
  " on ",
  " at ",
  " from ",
  " during ",
  " this ",
  " for ",
];

const PRONOUN_PARTICIPANT_TERMS = [
  "them",
  "him",
  "her",
  "that person",
  "this person",
  "the sender",
  "that sender",
];

const EMAIL_REGEX =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;

export type AttendeeResolutionReason =
  | "explicit_attendees"
  | "explicit_context_conflict"
  | "resolved_from_context"
  | "resolved_from_contacts"
  | "broad_group_reference"
  | "contextual_group_reference"
  | "ambiguous_context_reference"
  | "missing_context_reference"
  | "ambiguous_contact_match"
  | "no_contact_match"
  | "no_participant_intent";

export type AttendeeResolutionResult = {
  attendees: string[];
  participantIntent: boolean;
  autoResolved: boolean;
  confidence: "high" | "medium" | "low";
  reason: AttendeeResolutionReason;
  candidateEmails: string[];
};

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function includesLoose(haystack: string | undefined, needle: string | undefined): boolean {
  if (!needle) return false;
  const h = (haystack ?? "").toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n);
}

function extractParticipantPhrase(text: string): string | null {
  const match = text.match(/\b(?:with|to|for)\s+(.+)/iu);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function trimParticipantPhrase(phrase: string): string {
  const normalized = ` ${phrase.trim()} `;
  let cutIndex = normalized.length;
  for (const delimiter of PARTICIPANT_TRAILING_DELIMITERS) {
    const idx = normalized.toLowerCase().indexOf(delimiter);
    if (idx !== -1 && idx < cutIndex) {
      cutIndex = idx;
    }
  }
  return normalized.slice(0, cutIndex).trim();
}

function isBroadGroupPhrase(phrase: string): boolean {
  const normalized = phrase.toLowerCase();
  return TEAM_LIKE_TERMS.some((term) => normalized.includes(term));
}

function isPronounParticipantReference(text: string): boolean {
  const normalized = text.toLowerCase();
  return PRONOUN_PARTICIPANT_TERMS.some((term) => normalized.includes(term));
}

function collectEmailsFromText(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) ?? [];
  return matches.map((value) => normalizeEmail(value));
}

function scoreEmailAgainstPhrase(email: string, phrase: string): number {
  const normalizedPhrase = phrase.toLowerCase().trim();
  if (!normalizedPhrase) return 0;
  const lowerEmail = email.toLowerCase();
  let score = 0;
  if (lowerEmail.includes(normalizedPhrase)) score += 4;
  const localPart = lowerEmail.split("@")[0] ?? "";
  if (localPart.includes(normalizedPhrase.replace(/\s+/gu, ""))) score += 2;
  for (const token of normalizedPhrase.split(/[^a-z0-9]+/u).filter(Boolean)) {
    if (token.length < 2) continue;
    if (localPart.includes(token)) score += 1;
    if (lowerEmail.includes(token)) score += 1;
  }
  return score;
}

async function resolveContextualAttendeesFromEmailContext(params: {
  emailAccountId: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
  userEmail: string;
}): Promise<string[]> {
  if (!params.sourceEmailMessageId && !params.sourceEmailThreadId) {
    return [];
  }

  const message = await prisma.emailMessage.findFirst({
    where: {
      emailAccountId: params.emailAccountId,
      OR: [
        ...(params.sourceEmailMessageId
          ? [{ messageId: params.sourceEmailMessageId }, { id: params.sourceEmailMessageId }]
          : []),
        ...(params.sourceEmailThreadId ? [{ threadId: params.sourceEmailThreadId }] : []),
      ],
    },
    orderBy: { date: "desc" },
    select: {
      from: true,
      to: true,
    },
  });

  if (!message) {
    return [];
  }

  const ownerEmail = normalizeEmail(params.userEmail);
  const sender = normalizeEmail(extractEmailAddress(message.from));
  const recipients = extractEmailAddresses(message.to)
    .map((address) => normalizeEmail(address))
    .filter((address) => Boolean(address) && address !== ownerEmail);

  const candidates = new Set<string>();
  if (sender && sender !== ownerEmail) {
    candidates.add(sender);
  }
  for (const recipient of recipients) {
    candidates.add(recipient);
  }

  return Array.from(candidates);
}

async function resolveContextualAttendeesFromConversation(params: {
  userId: string;
  conversationId?: string;
  userEmail: string;
}): Promise<string[]> {
  const rows = await prisma.conversationMessage.findMany({
    where: {
      userId: params.userId,
      ...(params.conversationId ? { conversationId: params.conversationId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      content: true,
      toolCalls: true,
    },
  });

  const ownerEmail = normalizeEmail(params.userEmail);
  const emails = new Set<string>();
  for (const row of rows) {
    for (const email of collectEmailsFromText(row.content ?? "")) {
      if (email && email !== ownerEmail) emails.add(email);
    }

    if (!row.toolCalls || typeof row.toolCalls !== "object") continue;
    const toolCalls = row.toolCalls as Record<string, unknown>;
    const interactivePayloads = Array.isArray(toolCalls.interactivePayloads)
      ? toolCalls.interactivePayloads
      : [];
    for (const payload of interactivePayloads) {
      if (!payload || typeof payload !== "object") continue;
      const record = payload as Record<string, unknown>;
      const toList = Array.isArray(record.to)
        ? record.to.filter((value): value is string => typeof value === "string")
        : [];
      for (const email of toList.map((value) => normalizeEmail(value))) {
        if (email && email !== ownerEmail) emails.add(email);
      }
    }
  }

  const pendingApprovals = await prisma.approvalRequest.findMany({
    where: {
      userId: params.userId,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      requestPayload: true,
    },
  });

  for (const approval of pendingApprovals) {
    const payload =
      approval.requestPayload && typeof approval.requestPayload === "object"
        ? (approval.requestPayload as Record<string, unknown>)
        : null;
    if (!payload) continue;
    const args =
      payload.args && typeof payload.args === "object"
        ? (payload.args as Record<string, unknown>)
        : null;
    if (!args) continue;
    const data =
      args.data && typeof args.data === "object"
        ? (args.data as Record<string, unknown>)
        : null;
    const attendees = Array.isArray(data?.attendees)
      ? data?.attendees.filter((value): value is string => typeof value === "string")
      : [];
    for (const email of attendees.map((value) => normalizeEmail(value))) {
      if (email && email !== ownerEmail) emails.add(email);
    }
  }

  return Array.from(emails);
}

export async function resolveContextualAttendees(params: {
  userId: string;
  emailAccountId: string;
  userEmail: string;
  conversationId?: string;
  sourceEmailMessageId?: string;
  sourceEmailThreadId?: string;
}): Promise<string[]> {
  const [emailContext, conversationContext] = await Promise.all([
    resolveContextualAttendeesFromEmailContext({
      emailAccountId: params.emailAccountId,
      sourceEmailMessageId: params.sourceEmailMessageId,
      sourceEmailThreadId: params.sourceEmailThreadId,
      userEmail: params.userEmail,
    }),
    resolveContextualAttendeesFromConversation({
      userId: params.userId,
      conversationId: params.conversationId,
      userEmail: params.userEmail,
    }),
  ]);

  return Array.from(
    new Set([...emailContext, ...conversationContext].map((email) => normalizeEmail(email))),
  );
}

export async function resolveCalendarAttendees(params: {
  requestedAttendees: string[] | undefined;
  title: string;
  description?: string;
  currentMessage?: string;
  userEmail: string;
  contextualAttendees: string[];
  searchContacts: (query: string) => Promise<Array<{ email?: string; name?: string; company?: string }>>;
}): Promise<AttendeeResolutionResult> {
  const intentText = [params.currentMessage, params.title, params.description]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .trim();
  const combinedText = intentText.toLowerCase();
  const participantPhraseRaw = extractParticipantPhrase(intentText);
  const participantPhrase = participantPhraseRaw ? trimParticipantPhrase(participantPhraseRaw) : null;
  const hasTeamTerm = TEAM_LIKE_TERMS.some((term) => combinedText.includes(term));
  const pronounReference =
    isPronounParticipantReference(combinedText) ||
    isPronounParticipantReference(participantPhrase ?? "");

  const explicit = Array.from(
    new Set(
      (params.requestedAttendees ?? [])
        .map((email) => normalizeEmail(String(email)))
        .filter((email) => email.includes("@")),
    ),
  ).filter((email) => email !== normalizeEmail(params.userEmail));
  if (explicit.length > 0) {
    const contextAttendeeSet = new Set(params.contextualAttendees.map((email) => normalizeEmail(email)));
    const hasContextConflict =
      pronounReference &&
      contextAttendeeSet.size === 1 &&
      !explicit.some((email) => contextAttendeeSet.has(email));
    if (hasContextConflict) {
      return {
        attendees: explicit,
        participantIntent: true,
        autoResolved: false,
        confidence: "medium",
        reason: "explicit_context_conflict",
        candidateEmails: Array.from(contextAttendeeSet).slice(0, 1),
      };
    }
    return {
      attendees: explicit,
      participantIntent: true,
      autoResolved: false,
      confidence: "high",
      reason: "explicit_attendees",
      candidateEmails: [],
    };
  }

  const participantIntent = hasTeamTerm || Boolean(participantPhrase) || pronounReference;
  if (!participantIntent) {
    return {
      attendees: [],
      participantIntent: false,
      autoResolved: false,
      confidence: "low",
      reason: "no_participant_intent",
      candidateEmails: [],
    };
  }

  const contextCandidates = Array.from(
    new Set(params.contextualAttendees.map((email) => normalizeEmail(email))),
  );

  if (pronounReference) {
    if (contextCandidates.length === 1) {
      return {
        attendees: contextCandidates,
        participantIntent: true,
        autoResolved: true,
        confidence: "high",
        reason: "resolved_from_context",
        candidateEmails: [],
      };
    }
    if (contextCandidates.length > 1) {
      return {
        attendees: [],
        participantIntent: true,
        autoResolved: false,
        confidence: "medium",
        reason: "ambiguous_context_reference",
        candidateEmails: contextCandidates.slice(0, 6),
      };
    }
    return {
      attendees: [],
      participantIntent: true,
      autoResolved: false,
      confidence: "low",
      reason: "missing_context_reference",
      candidateEmails: [],
    };
  }

  if (hasTeamTerm || (participantPhrase && isBroadGroupPhrase(participantPhrase))) {
    if (contextCandidates.length >= 2 && contextCandidates.length <= 8) {
      return {
        attendees: [],
        participantIntent: true,
        autoResolved: false,
        confidence: "medium",
        reason: "contextual_group_reference",
        candidateEmails: contextCandidates,
      };
    }
    return {
      attendees: [],
      participantIntent: true,
      autoResolved: false,
      confidence: "low",
      reason: "broad_group_reference",
      candidateEmails: contextCandidates.slice(0, 6),
    };
  }

  const queries = new Set<string>();
  if (participantPhrase) {
    queries.add(participantPhrase);
    for (const token of participantPhrase.split(/\s*(?:,|and|&)\s*/iu)) {
      const trimmed = token.trim();
      if (trimmed.length >= 2) {
        queries.add(trimmed);
        for (const word of trimmed.split(/\s+/u)) {
          const normalized = word.trim();
          if (normalized.length >= 3) {
            queries.add(normalized);
          }
        }
      }
    }
  }

  const scored = new Map<string, number>();
  for (const contextual of contextCandidates) {
    const score = participantPhrase ? scoreEmailAgainstPhrase(contextual, participantPhrase) : 0;
    if (score > 0) scored.set(contextual, score + 2);
  }

  for (const query of queries) {
    let contacts: Array<{ email?: string; name?: string; company?: string }> = [];
    try {
      contacts = await params.searchContacts(query);
    } catch {
      continue;
    }
    for (const contact of contacts) {
      const rawEmail = contact.email ? normalizeEmail(contact.email) : "";
      if (!rawEmail || !rawEmail.includes("@") || rawEmail === normalizeEmail(params.userEmail)) continue;

      let score = scored.get(rawEmail) ?? 0;
      if (includesLoose(contact.name, query) || includesLoose(contact.email, query)) {
        score += 3;
      }
      if (includesLoose(contact.company, query)) {
        score += 1;
      }
      if (contextCandidates.includes(rawEmail)) {
        score += 2;
      }
      scored.set(rawEmail, score);
    }
  }

  const ranked = Array.from(scored.entries())
    .filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length === 0) {
    return {
      attendees: [],
      participantIntent: true,
      autoResolved: false,
      confidence: "low",
      reason: "no_contact_match",
      candidateEmails: contextCandidates.slice(0, 6),
    };
  }

  if (ranked.length === 1) {
    return {
      attendees: [ranked[0][0]],
      participantIntent: true,
      autoResolved: true,
      confidence: "high",
      reason: contextCandidates.includes(ranked[0][0]) ? "resolved_from_context" : "resolved_from_contacts",
      candidateEmails: [],
    };
  }

  const [top, second] = ranked;
  if (top && second && top[1] >= second[1] + 2) {
    return {
      attendees: [top[0]],
      participantIntent: true,
      autoResolved: true,
      confidence: "medium",
      reason: contextCandidates.includes(top[0]) ? "resolved_from_context" : "resolved_from_contacts",
      candidateEmails: ranked.slice(1, 5).map(([email]) => email),
    };
  }

  return {
    attendees: [],
    participantIntent: true,
    autoResolved: false,
    confidence: "medium",
    reason: "ambiguous_contact_match",
    candidateEmails: ranked.slice(0, 6).map(([email]) => email),
  };
}
