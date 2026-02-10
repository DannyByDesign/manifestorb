import type { ChannelProvider } from "./types";

const THREADLESS_PROVIDERS = new Set<ChannelProvider>(["discord", "telegram"]);

function isThreadlessConversation(params: {
  provider: ChannelProvider;
  isDirectMessage?: boolean;
}): boolean {
  if (THREADLESS_PROVIDERS.has(params.provider)) return true;
  return false;
}

function normalizeId(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function deriveCanonicalThreadId(params: {
  provider: ChannelProvider;
  isDirectMessage?: boolean;
  incomingThreadId?: string | null;
  messageId?: string | null;
}): string {
  if (
    isThreadlessConversation({
      provider: params.provider,
      isDirectMessage: params.isDirectMessage,
    })
  ) {
    return "root";
  }
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
  isDirectMessage?: boolean;
  canonicalThreadId: string;
}): string | undefined {
  if (
    params.canonicalThreadId === "root" ||
    isThreadlessConversation({
      provider: params.provider,
      isDirectMessage: params.isDirectMessage,
    })
  ) {
    return undefined;
  }
  return params.canonicalThreadId;
}
