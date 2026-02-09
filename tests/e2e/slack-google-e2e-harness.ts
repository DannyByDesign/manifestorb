/**
 * Harness for Slack ↔ Main App ↔ Google Suite E2E tests.
 * Requires RUN_LIVE_SLACK_GOOGLE_E2E=true and Slack + optional LIVE_* env (see README).
 */
import {
  loadLiveContext,
  sendInboundEmail,
  createCalendarEvent,
  listCalendarEvents,
  deleteCalendarEvent,
  getPendingApproval,
  approve,
  wait,
  listSentMessages,
  type LiveContext,
} from "./critical-e2e-harness";

const SLACK_API_BASE = "https://slack.com/api";

export { loadLiveContext, sendInboundEmail, createCalendarEvent, listCalendarEvents, deleteCalendarEvent, getPendingApproval, approve, wait, listSentMessages, type LiveContext };

export const SLACK_E2E_PREFIX = "[E2E-Slack]";

const requiredSlackEnv = ["SLACK_BOT_TOKEN", "TEST_SLACK_CHANNEL_ID", "TEST_SLACK_USER_ID"] as const;

/** Bot token: used for reading channel/thread (conversations.history, conversations.replies). */
function getSlackToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN required for Slack E2E");
  return token;
}

let _warnedPostingAsBot = false;

/**
 * Token used to *post* messages. If TEST_SLACK_USER_TOKEN is set (user OAuth token with
 * chat:write:user), messages appear as the user. Otherwise we use the bot token and
 * messages appear as the app.
 */
function getSlackPostToken(): string {
  const userToken = process.env.TEST_SLACK_USER_TOKEN?.trim();
  if (userToken) return userToken;
  if (!_warnedPostingAsBot) {
    _warnedPostingAsBot = true;
    console.warn(
      "[Slack E2E] Posting as bot. To have test messages appear as you, set TEST_SLACK_USER_TOKEN in .env.test.local or surfaces/.env.local (user OAuth token starting with xoxp-, scope chat:write:user). See tests/e2e/README.md.",
    );
  }
  return getSlackToken();
}

function getSlackChannelId(): string {
  const id = process.env.TEST_SLACK_CHANNEL_ID;
  if (!id) throw new Error("TEST_SLACK_CHANNEL_ID required for Slack E2E");
  return id;
}

function getSlackUserId(): string {
  const id = process.env.TEST_SLACK_USER_ID;
  if (!id) throw new Error("TEST_SLACK_USER_ID required for Slack E2E");
  return id;
}

/**
 * Ensure required Slack E2E env vars are set. Call at start of tests that need real Slack.
 */
export function requireSlackEnv(): void {
  const missing = requiredSlackEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing Slack E2E env: ${missing.join(", ")}`);
  }
}

/**
 * Post a message to Slack (channel or thread). Returns ts and channel.
 * Uses TEST_SLACK_USER_TOKEN when set so the message appears as you (the user);
 * otherwise uses the bot token and the message appears as the app.
 */
export async function postSlackMessage(params: {
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<{ ts: string; channel: string }> {
  const token = getSlackPostToken();
  const body: Record<string, string> = {
    channel: params.channel,
    text: params.text,
  };
  if (params.thread_ts) body.thread_ts = params.thread_ts;

  const res = await fetch(`${SLACK_API_BASE}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Slack chat.postMessage failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { ok?: boolean; message?: { ts?: string; channel?: string }; ts?: string; channel?: string };
  if (!data.ok) {
    throw new Error(`Slack API error: ${JSON.stringify(data)}`);
  }
  const ts = data.message?.ts ?? data.ts ?? "";
  const channel = data.message?.channel ?? data.channel ?? params.channel;
  // Space out messages so the bot isn’t flooded; 15s between each post.
  await wait(15_000);
  return { ts, channel };
}

export interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
}

/**
 * Get replies in a thread.
 */
export async function getSlackThreadReplies(params: {
  channel: string;
  thread_ts: string;
}): Promise<{ messages: SlackMessage[] }> {
  const token = getSlackToken();
  const url = new URL(`${SLACK_API_BASE}/conversations.replies`);
  url.searchParams.set("channel", params.channel);
  url.searchParams.set("ts", params.thread_ts);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Slack conversations.replies failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { ok?: boolean; messages?: SlackMessage[] };
  if (!data.ok) {
    throw new Error(`Slack API error: ${JSON.stringify(data)}`);
  }
  return { messages: data.messages ?? [] };
}

/**
 * Get channel history (latest messages).
 */
export async function getSlackChannelHistory(params: {
  channel: string;
  limit: number;
}): Promise<{ messages: SlackMessage[] }> {
  const token = getSlackToken();
  const url = new URL(`${SLACK_API_BASE}/conversations.history`);
  url.searchParams.set("channel", params.channel);
  url.searchParams.set("limit", String(params.limit));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Slack conversations.history failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { ok?: boolean; messages?: SlackMessage[] };
  if (!data.ok) {
    throw new Error(`Slack API error: ${JSON.stringify(data)}`);
  }
  return { messages: data.messages ?? [] };
}

/**
 * Poll thread until a new bot message appears or timeout. Returns latest replies.
 * Use when the bot replies in the thread.
 */
export async function waitForSlackResponse(params: {
  channel: string;
  thread_ts: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ messages: SlackMessage[] }> {
  const timeoutMs = params.timeoutMs ?? 30_000;
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    const { messages } = await getSlackThreadReplies({
      channel: params.channel,
      thread_ts: params.thread_ts,
    });
    if (messages.length > lastCount) {
      const botMessages = messages.filter((m) => m.bot_id);
      if (botMessages.length > 0) return { messages };
    }
    lastCount = messages.length;
    await wait(pollIntervalMs);
  }
  return getSlackThreadReplies({ channel: params.channel, thread_ts: params.thread_ts });
}

/**
 * Poll channel until a new bot message appears after the given ts, or timeout.
 * Use when the bot replies in the channel (not in a thread). Returns channel history slice.
 */
export async function waitForSlackChannelResponse(params: {
  channel: string;
  afterTs: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<{ messages: SlackMessage[] }> {
  const timeoutMs = params.timeoutMs ?? 30_000;
  const pollIntervalMs = params.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { messages } = await getSlackChannelHistory({
      channel: params.channel,
      limit: 30,
    });
    const botAfter = messages.filter((m) => m.bot_id && m.ts > params.afterTs);
    if (botAfter.length > 0) return { messages };
    await wait(pollIntervalMs);
  }
  const { messages } = await getSlackChannelHistory({
    channel: params.channel,
    limit: 30,
  });
  return { messages };
}

/**
 * Simulate sidecar forwarding a message to the main app (POST /api/surfaces/inbound).
 * Use when real Slack + sidecar are not running. Returns responses from the main app.
 */
export async function simulateInboundSlackMessage(params: {
  content: string;
  channelId: string;
  userId: string;
  messageId: string;
  threadId?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<{ responses: Array<{ content?: string; targetChannelId?: string; interactive?: unknown }> }> {
  const secret = process.env.SURFACES_SHARED_SECRET;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000";
  if (!secret) throw new Error("SURFACES_SHARED_SECRET required for simulateInboundSlackMessage");

  const url = `${baseUrl}/api/surfaces/inbound`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-surfaces-secret": secret,
    },
    body: JSON.stringify({
      provider: "slack",
      content: params.content,
      context: {
        channelId: params.channelId,
        userId: params.userId,
        messageId: params.messageId,
        isDirectMessage: false,
        threadId: params.threadId,
      },
      history: params.history,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`inbound API failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { responses?: Array<{ content?: string; targetChannelId?: string; interactive?: unknown }> };
  return { responses: data.responses ?? [] };
}

// --- Date helpers for tests ---

export function getTomorrowAt2PM(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(14, 0, 0, 0);
  return d.toISOString();
}

export function getNextTuesday(): Date {
  const today = new Date();
  const day = today.getDay();
  const daysUntilTuesday = (2 - day + 7) % 7;
  const next = new Date(today);
  next.setDate(today.getDate() + (daysUntilTuesday === 0 ? 7 : daysUntilTuesday));
  return next;
}

export function getNextWednesday(): Date {
  const today = new Date();
  const day = today.getDay();
  const daysUntilWednesday = (3 - day + 7) % 7;
  const next = new Date(today);
  next.setDate(today.getDate() + (daysUntilWednesday === 0 ? 7 : daysUntilWednesday));
  return next;
}

export function setHours(d: Date, h: number, m: number): Date {
  const out = new Date(d);
  out.setHours(h, m, 0, 0);
  return out;
}
