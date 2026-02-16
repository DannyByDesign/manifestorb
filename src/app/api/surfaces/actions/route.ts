import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/env";
import { createScopedLogger } from "@/server/lib/logger";

const logger = createScopedLogger("api/surfaces/actions");
const SHARED_SECRET = env.SURFACES_SHARED_SECRET;

const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("approval"),
    requestId: z.string().min(1),
    decision: z.enum(["approve", "deny"]),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal("ambiguous_time"),
    requestId: z.string().min(1),
    choice: z.enum(["earlier", "later"]),
  }),
  z.object({
    type: z.literal("draft"),
    draftId: z.string().min(1),
    decision: z.enum(["send", "discard"]),
    userId: z.string().min(1),
    emailAccountId: z.string().min(1),
  }),
]);

const bodySchema = z.object({
  provider: z.enum(["slack", "discord", "telegram"]),
  providerAccountId: z.string().min(1),
  action: actionSchema,
});

type ProxiedActionResponse = {
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
};

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const candidates = [record.error, record.message, record.detail];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return null;
}

async function proxyToCore(params: {
  req: NextRequest;
  surfacesSecret: string;
  path: string;
  method: "POST" | "DELETE";
  body?: Record<string, unknown>;
}): Promise<ProxiedActionResponse> {
  const origin = params.req.nextUrl.origin;
  const response = await fetch(`${origin}${params.path}`, {
    method: params.method,
    headers: {
      "Content-Type": "application/json",
      "x-surfaces-secret": params.surfacesSecret,
    },
    body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
  });

  let parsedBody: unknown = null;
  let bodyText = "";
  try {
    parsedBody = await response.json();
  } catch {
    bodyText = await response.text().catch(() => "");
  }

  const error =
    response.ok
      ? undefined
      : extractErrorMessage(parsedBody) ??
        (bodyText.length > 0 ? bodyText.slice(0, 500) : response.statusText || "request_failed");

  return {
    ok: response.ok,
    status: response.status,
    ...(parsedBody !== null ? { body: parsedBody } : {}),
    ...(error ? { error } : {}),
  };
}

export async function POST(req: NextRequest) {
  const surfacesSecret = SHARED_SECRET;
  const authHeader = req.headers.get("x-surfaces-secret");
  const authBearer = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!surfacesSecret || (authHeader !== surfacesSecret && authBearer !== surfacesSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { provider, providerAccountId, action } = parsed.data;
    let proxied: ProxiedActionResponse;

    if (action.type === "approval") {
      proxied = await proxyToCore({
        req,
        surfacesSecret,
        path: `/api/approvals/${action.requestId}/${action.decision}`,
        method: "POST",
        body: {
          provider,
          userId: providerAccountId,
          reason: action.reason,
        },
      });
    } else if (action.type === "ambiguous_time") {
      proxied = await proxyToCore({
        req,
        surfacesSecret,
        path: `/api/ambiguous-time/${action.requestId}/resolve`,
        method: "POST",
        body: {
          choice: action.choice,
        },
      });
    } else if (action.decision === "send") {
      proxied = await proxyToCore({
        req,
        surfacesSecret,
        path: `/api/drafts/${action.draftId}/send`,
        method: "POST",
        body: {
          userId: action.userId,
          emailAccountId: action.emailAccountId,
        },
      });
    } else {
      const query = new URLSearchParams({
        userId: action.userId,
        emailAccountId: action.emailAccountId,
      });
      proxied = await proxyToCore({
        req,
        surfacesSecret,
        path: `/api/drafts/${action.draftId}?${query.toString()}`,
        method: "DELETE",
      });
    }

    if (!proxied.ok) {
      logger.warn("Surface action proxy failed", {
        provider,
        actionType: action.type,
        status: proxied.status,
        error: proxied.error ?? null,
      });
    }

    return NextResponse.json(proxied, {
      status: proxied.ok ? 200 : proxied.status,
    });
  } catch (error) {
    logger.error("Surface action proxy crashed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
