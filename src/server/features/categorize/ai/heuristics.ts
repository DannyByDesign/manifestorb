import type { EmailAccountWithAI } from "@/server/lib/llms/types";

const FINANCE_KEYWORDS = [
  "invoice",
  "receipt",
  "payment",
  "billing",
  "renewal",
  "refund",
  "charge",
];
const SCHEDULING_KEYWORDS = [
  "meeting",
  "schedule",
  "reschedule",
  "calendar",
  "invite",
  "availability",
  "book a time",
];
const ACTION_REQUIRED_KEYWORDS = [
  "can you",
  "could you",
  "please",
  "need",
  "request",
  "action required",
];
const MARKETING_KEYWORDS = [
  "sale",
  "discount",
  "offer",
  "promo",
  "promotion",
  "deal",
  "marketing",
];
const UPDATES_KEYWORDS = ["update", "status", "notification", "fyi"];
const PERSONAL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
];

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function extractDomain(address: string): string | null {
  const atIndex = address.lastIndexOf("@");
  if (atIndex === -1 || atIndex === address.length - 1) return null;
  return address.slice(atIndex + 1).toLowerCase();
}

function hasKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

export function categorizeSenderHeuristic({
  emailAccount,
  sender,
  emails,
}: {
  emailAccount: EmailAccountWithAI;
  sender: string;
  emails: { subject: string; snippet: string }[];
}): string | null {
  const senderDomain = extractDomain(sender);
  const accountDomain = extractDomain(emailAccount.email ?? "");
  const combinedText = normalizeText(
    emails.map((email) => `${email.subject} ${email.snippet}`).join(" "),
  );

  if (senderDomain && accountDomain && senderDomain === accountDomain) {
    return "Internal";
  }

  if (hasKeyword(combinedText, FINANCE_KEYWORDS)) return "Finance";
  if (hasKeyword(combinedText, SCHEDULING_KEYWORDS)) return "Scheduling";
  if (hasKeyword(combinedText, ACTION_REQUIRED_KEYWORDS)) return "Action Required";
  if (hasKeyword(combinedText, MARKETING_KEYWORDS)) return "Marketing";
  if (hasKeyword(combinedText, UPDATES_KEYWORDS)) return "Updates";

  if (senderDomain && PERSONAL_DOMAINS.includes(senderDomain)) {
    return "External People";
  }

  return null;
}
