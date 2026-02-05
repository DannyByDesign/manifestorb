import { createHmac, timingSafeEqual } from "crypto";
import { env } from "@/env";

type ApprovalAction = "approve" | "deny";

type ApprovalTokenPayload = {
  approvalId: string;
  action: ApprovalAction;
  exp: number;
};

function getSecret() {
  return (
    env.APPROVAL_ACTION_SECRET ||
    env.AUTH_SECRET ||
    ""
  );
}

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

export function createApprovalActionToken(params: {
  approvalId: string;
  action: ApprovalAction;
  expiresInSeconds?: number;
}) {
  const secret = getSecret();
  if (!secret) {
    throw new Error("Missing approval action secret");
  }

  const payload: ApprovalTokenPayload = {
    approvalId: params.approvalId,
    action: params.action,
    exp: Math.floor(Date.now() / 1000) + (params.expiresInSeconds ?? 3600),
  };

  const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64url");

  return `${payloadEncoded}.${signature}`;
}

export function verifyApprovalActionToken(token: string) {
  const secret = getSecret();
  if (!secret) {
    return null;
  }

  const [payloadEncoded, signature] = token.split(".");
  if (!payloadEncoded || !signature) return null;

  const expected = createHmac("sha256", secret)
    .update(payloadEncoded)
    .digest("base64url");

  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }

  const payload = JSON.parse(base64UrlDecode(payloadEncoded)) as ApprovalTokenPayload;
  if (!payload?.approvalId || !payload.action || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}
