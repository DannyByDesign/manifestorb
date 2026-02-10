import type { ChannelProvider } from "./types";

const THREADLESS_PROVIDERS = new Set<ChannelProvider>(["discord", "telegram"]);

function normalizeId(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function deriveCanonicalThreadId(params: {
  provider: ChannelProvider;
  incomingThreadId?: string | null;
  messageId?: string | null;
}): string {
  if (THREADLESS_PROVIDERS.has(params.provider)) return "root";
  return (
    normalizeId(params.incomingThreadId) ??
    normalizeId(params.messageId) ??
    "root"
  );
}

export function buildConversationIdentityKey(params: {
  userId: string;
  provider: ChannelProvider;
  channelId: string;
  threadId: string;
}): string {
  return [
    params.userId,
    params.provider,
    params.channelId,
    params.threadId,
  ].join(":");
}

export function outboundThreadIdForProvider(params: {
  provider: ChannelProvider;
  canonicalThreadId: string;
}): string | undefined {
  if (THREADLESS_PROVIDERS.has(params.provider)) return undefined;
  return params.canonicalThreadId;
}
