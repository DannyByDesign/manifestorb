import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { createScopedLogger } from "@/server/lib/logger";
import { findUserEmailAccountWithProvider } from "@/server/lib/user/email-account";
import { createEmailProvider } from "@/server/features/ai/tools/providers/email";
import { createCalendarProvider } from "@/server/features/ai/tools/providers/calendar";
import { createUnifiedSearchService } from "@/server/features/search/unified/service";
import type {
  UnifiedSearchMailbox,
  UnifiedSearchRequest,
  UnifiedSearchSurface,
} from "@/server/features/search/unified/types";

const logger = createScopedLogger("api/search/unified");

const surfaceSchema = z.enum(["email", "calendar", "rule", "memory"]);
const mailboxSchema = z.enum([
  "inbox",
  "sent",
  "draft",
  "trash",
  "spam",
  "archive",
  "all",
]);
const sortSchema = z.enum(["relevance", "newest", "oldest"]);

const requestSchema = z
  .object({
    query: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    scopes: z.array(surfaceSchema).optional(),
    mailbox: mailboxSchema.optional(),
    sort: sortSchema.optional(),
    unread: z.boolean().optional(),
    hasAttachment: z.boolean().optional(),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    attendeeEmail: z.string().min(1).optional(),
    dateRange: z
      .object({
        after: z.string().optional(),
        before: z.string().optional(),
        timeZone: z.string().optional(),
      })
      .optional(),
    limit: z.number().int().min(1).max(200).optional(),
    fetchAll: z.boolean().optional(),
  })
  .strict();

async function buildSearchService(userId: string) {
  const emailAccount = await findUserEmailAccountWithProvider({ userId });
  if (!emailAccount) {
    return { error: "No connected email account found for unified search." } as const;
  }

  const emailProvider = await createEmailProvider(
    {
      id: emailAccount.id,
      provider: emailAccount.account.provider,
      access_token: null,
      refresh_token: null,
      expires_at: null,
      email: emailAccount.email,
    },
    logger,
  );

  const calendarProvider = await createCalendarProvider(
    { id: emailAccount.id },
    userId,
    logger,
  );

  return {
    search: createUnifiedSearchService({
      userId,
      emailAccountId: emailAccount.id,
      email: emailAccount.email,
      logger,
      providers: {
        email: emailProvider,
        calendar: calendarProvider,
      },
    }),
  } as const;
}

function parseScopes(raw: string | null): UnifiedSearchSurface[] | undefined {
  if (!raw) return undefined;
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is UnifiedSearchSurface =>
      ["email", "calendar", "rule", "memory"].includes(entry),
    );
  return parsed.length > 0 ? parsed : undefined;
}

function parseMailbox(raw: string | null): UnifiedSearchMailbox | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  return ["inbox", "sent", "draft", "trash", "spam", "archive", "all"].includes(
    normalized,
  )
    ? (normalized as UnifiedSearchMailbox)
    : undefined;
}

function parseGetRequest(req: NextRequest): UnifiedSearchRequest {
  const params = req.nextUrl.searchParams;

  const after = params.get("after") ?? undefined;
  const before = params.get("before") ?? undefined;
  const timeZone = params.get("timeZone") ?? undefined;

  return {
    query: params.get("query") ?? undefined,
    text: params.get("text") ?? undefined,
    scopes: parseScopes(params.get("scopes")),
    mailbox: parseMailbox(params.get("mailbox")),
    sort:
      params.get("sort") === "relevance" ||
      params.get("sort") === "newest" ||
      params.get("sort") === "oldest"
        ? (params.get("sort") as "relevance" | "newest" | "oldest")
        : undefined,
    unread:
      params.get("unread") === "true"
        ? true
        : params.get("unread") === "false"
          ? false
          : undefined,
    hasAttachment:
      params.get("hasAttachment") === "true"
        ? true
        : params.get("hasAttachment") === "false"
          ? false
          : undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    attendeeEmail: params.get("attendeeEmail") ?? undefined,
    dateRange:
      after || before || timeZone
        ? {
            after,
            before,
            timeZone,
          }
        : undefined,
    limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    fetchAll: params.get("fetchAll") === "true",
  };
}

async function ensureSessionUser() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }
  return { userId: session.user.id } as const;
}

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const session = await ensureSessionUser();
    if ("error" in session) return session.error;

    const serviceResult = await buildSearchService(session.userId);
    if ("error" in serviceResult) {
      return NextResponse.json({ error: serviceResult.error }, { status: 400 });
    }

    const request = parseGetRequest(req);
    const parsed = requestSchema.safeParse(request);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid search request", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const result = await serviceResult.search.query(parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("Unified search GET failed", { error });
    return NextResponse.json({ error: "Unified search failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await ensureSessionUser();
    if ("error" in session) return session.error;

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid search request", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const serviceResult = await buildSearchService(session.userId);
    if ("error" in serviceResult) {
      return NextResponse.json({ error: serviceResult.error }, { status: 400 });
    }

    const result = await serviceResult.search.query(parsed.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error("Unified search POST failed", { error });
    return NextResponse.json({ error: "Unified search failed" }, { status: 500 });
  }
}
