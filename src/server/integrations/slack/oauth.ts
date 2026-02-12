import { randomUUID } from "node:crypto";

export type SlackOAuthExchangeResult =
  | {
      ok: true;
      teamId: string;
      teamName?: string | null;
      authedUserId: string;
      appId?: string | null;
    }
  | { ok: false; error: string; errorCode?: string | null };

export function encodeSlackState(payload: {
  userId: string;
  nonce: string;
  createdAt: number;
}): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeSlackState(
  state: string,
): { ok: true; userId: string; nonce: string; createdAt: number } | { ok: false } {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return { ok: false };
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.userId !== "string" || typeof rec.nonce !== "string" || typeof rec.createdAt !== "number") {
      return { ok: false };
    }
    return { ok: true, userId: rec.userId, nonce: rec.nonce, createdAt: rec.createdAt };
  } catch {
    return { ok: false };
  }
}

export function generateSlackOAuthState(userId: string): {
  state: string;
  nonce: string;
} {
  const nonce = randomUUID();
  return {
    nonce,
    state: encodeSlackState({ userId, nonce, createdAt: Date.now() }),
  };
}

export async function exchangeSlackOAuthCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}): Promise<SlackOAuthExchangeResult> {
  const body = new URLSearchParams();
  body.set("client_id", params.clientId);
  body.set("client_secret", params.clientSecret);
  body.set("code", params.code);
  body.set("redirect_uri", params.redirectUri);

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json().catch(() => null)) as any;
  if (!json || typeof json !== "object") {
    return { ok: false, error: "Slack OAuth response was invalid." };
  }

  if (!json.ok) {
    return {
      ok: false,
      error: typeof json.error === "string" ? json.error : "Slack OAuth failed.",
      errorCode: typeof json.error === "string" ? json.error : null,
    };
  }

  const teamId = json.team?.id;
  const authedUserId = json.authed_user?.id;
  if (typeof teamId !== "string" || typeof authedUserId !== "string") {
    return { ok: false, error: "Slack OAuth response missing team or user." };
  }

  return {
    ok: true,
    teamId,
    teamName: typeof json.team?.name === "string" ? json.team.name : null,
    authedUserId,
    appId: typeof json.app_id === "string" ? json.app_id : null,
  };
}

