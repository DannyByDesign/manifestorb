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

function buildInternalRequest(params: {
  req: NextRequest;
  surfacesSecret: string;
  pathname: string;
  method: "POST" | "DELETE";
  body?: Record<string, unknown>;
}): NextRequest {
  const url = new URL(params.pathname, params.req.nextUrl.origin);
  return new NextRequest(url, {
    method: params.method,
    headers: {
      "Content-Type": "application/json",
      "x-surfaces-secret": params.surfacesSecret,
    },
    body: params.method === "POST" ? JSON.stringify(params.body ?? {}) : undefined,
  });
}

async function toProxiedActionResponse(response: Response): Promise<ProxiedActionResponse> {
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
      const route =
        action.decision === "approve"
          ? (await import("@/app/api/approvals/[id]/approve/route")).POST
          : (await import("@/app/api/approvals/[id]/deny/route")).POST;

      const response = await route(
        buildInternalRequest({
          req,
          surfacesSecret,
          pathname: `/api/approvals/${action.requestId}/${action.decision}`,
          method: "POST",
          body: {
            provider,
            userId: providerAccountId,
            reason: action.reason,
          },
        }),
        { params: Promise.resolve({ id: action.requestId }) },
      );
      proxied = await toProxiedActionResponse(response);
    } else if (action.type === "ambiguous_time") {
      const route = (await import("@/app/api/ambiguous-time/[id]/resolve/route")).POST;
      const response = await route(
        buildInternalRequest({
          req,
          surfacesSecret,
          pathname: `/api/ambiguous-time/${action.requestId}/resolve`,
          method: "POST",
          body: {
            choice: action.choice,
          },
        }),
        { params: Promise.resolve({ id: action.requestId }) },
      );
      proxied = await toProxiedActionResponse(response);
    } else if (action.decision === "send") {
      const route = (await import("@/app/api/drafts/[id]/send/route")).POST;
      const response = await route(
        buildInternalRequest({
          req,
          surfacesSecret,
          pathname: `/api/drafts/${action.draftId}/send`,
          method: "POST",
          body: {
            userId: action.userId,
            emailAccountId: action.emailAccountId,
          },
        }),
        { params: Promise.resolve({ id: action.draftId }) },
      );
      proxied = await toProxiedActionResponse(response);
    } else {
      const route = (await import("@/app/api/drafts/[id]/route")).DELETE;
      const query = new URLSearchParams({
        userId: action.userId,
        emailAccountId: action.emailAccountId,
      });
      const response = await route(
        buildInternalRequest({
          req,
          surfacesSecret,
          pathname: `/api/drafts/${action.draftId}?${query.toString()}`,
          method: "DELETE",
        }),
        { params: Promise.resolve({ id: action.draftId }) },
      );
      proxied = await toProxiedActionResponse(response);
    }

    if (!proxied.ok) {
      logger.warn("Surface action execution failed", {
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
    logger.error("Surface action execution crashed", { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 },
    );
  }
}
