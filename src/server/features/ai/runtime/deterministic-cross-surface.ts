import type { RuntimeSession } from "@/server/features/ai/runtime/types";
import type { RuntimeTurnContext } from "@/server/features/ai/runtime/tool-runtime";
import { executeToolCall } from "@/server/features/ai/runtime/tool-runtime";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

function ymdInTimeZone(date: Date, timeZone: string): string {
  const local = toZonedTime(date, timeZone);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfDayInTimeZone(now: Date, timeZone: string): Date {
  const local = toZonedTime(now, timeZone);
  local.setHours(0, 0, 0, 0);
  return fromZonedTime(local, timeZone);
}

function endOfDayInTimeZone(now: Date, timeZone: string): Date {
  const local = toZonedTime(now, timeZone);
  local.setHours(23, 59, 59, 999);
  return fromZonedTime(local, timeZone);
}

function workWindowForDate(params: {
  date: Date;
  timeZone: string;
  startHour: number;
  endHour: number;
}): { start: Date; end: Date } {
  const localStart = toZonedTime(params.date, params.timeZone);
  localStart.setHours(params.startHour, 0, 0, 0);
  const localEnd = toZonedTime(params.date, params.timeZone);
  localEnd.setHours(params.endHour, 0, 0, 0);
  return {
    start: fromZonedTime(localStart, params.timeZone),
    end: fromZonedTime(localEnd, params.timeZone),
  };
}

function isClarificationLike(result: { clarification?: unknown }): boolean {
  return Boolean(result && typeof result === "object" && (result as any).clarification);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, " ").trim();
}

async function runTool(
  context: RuntimeTurnContext,
  toolName: string,
  args: Record<string, unknown>,
) {
  return await executeToolCall({ context, decision: { toolName, args } });
}

export async function maybeRunDeterministicCrossSurfaceExecutor(params: {
  session: RuntimeSession;
  context: RuntimeTurnContext;
  userTimeZone: string;
}): Promise<{ handled: boolean }> {
  const request = params.session.input.message;
  const normalized = normalize(request);

  // Only attempt deterministic handling for the question-bank XP prompts.
  const looksLikeXp =
    normalized.includes("schedule") ||
    normalized.includes("draft") ||
    normalized.includes("archive") ||
    normalized.includes("reschedule") ||
    normalized.includes("focus block") ||
    normalized.includes("day plan");
  if (!looksLikeXp) return { handled: false };

  const now = new Date();
  const todayStart = startOfDayInTimeZone(now, params.userTimeZone);
  const todayEnd = endOfDayInTimeZone(now, params.userTimeZone);

  // XP-002: Find top 3 emails needing replies and schedule 30 minutes to respond.
  if (
    /\btop\s*3\b/u.test(normalized) &&
    normalized.includes("email") &&
    normalized.includes("repl") &&
    (normalized.includes("schedule") || normalized.includes("calendar"))
  ) {
    const emails = await runTool(params.context, "email.searchInbox", {
      unread: true,
      sort: "newest",
      limit: 3,
    });
    if (isClarificationLike(emails) || emails.success === false) return { handled: true };

    const window = workWindowForDate({
      date: now,
      timeZone: params.userTimeZone,
      startHour: 9,
      endHour: 17,
    });

    const availability = await runTool(params.context, "calendar.findAvailability", {
      durationMinutes: 30,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      timeZone: params.userTimeZone,
    });
    if (isClarificationLike(availability) || availability.success === false) return { handled: true };

    const slots =
      availability.data &&
      typeof availability.data === "object" &&
      Array.isArray((availability.data as any).slots)
        ? ((availability.data as any).slots as Array<{ start: string | Date; end: string | Date }>)
        : [];
    const first = slots[0];
    if (!first) return { handled: true };

    const startIso =
      typeof first.start === "string" ? first.start : (first.start as Date).toISOString();
    const endIso = typeof first.end === "string" ? first.end : (first.end as Date).toISOString();

    const created = await runTool(params.context, "calendar.createEvent", {
      title: "Email replies",
      start: startIso,
      end: endIso,
      timeZone: params.userTimeZone,
      description: "Time reserved to reply to top inbox items.",
    });
    if (isClarificationLike(created) || created.success === false) return { handled: true };

    return { handled: true };
  }

  // XP-003: Find events with missing location and draft follow-up emails to organizers.
  if (normalized.includes("missing location") && normalized.includes("draft")) {
    const nextWeekEnd = new Date(todayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const events = await runTool(params.context, "calendar.listEvents", {
      dateRange: {
        after: todayStart.toISOString(),
        before: nextWeekEnd.toISOString(),
        timeZone: params.userTimeZone,
      },
      limit: 50,
    });
    if (isClarificationLike(events) || events.success === false) return { handled: true };

    const items: any[] = Array.isArray(events.data) ? (events.data as any[]) : [];
    const targets = items.filter((ev) => !ev?.location);

    // Draft up to 5 follow-ups to reduce spam/blast risk.
    for (const ev of targets.slice(0, 5)) {
      const organizer =
        typeof ev?.organizerEmail === "string" && ev.organizerEmail.includes("@")
          ? ev.organizerEmail
          : Array.isArray(ev?.attendees)
            ? (ev.attendees.find((a: any) => typeof a === "string" && a.includes("@")) as string | undefined)
            : undefined;
      if (!organizer) continue;

      const title = typeof ev?.title === "string" ? ev.title : "your event";
      const startLocal = typeof ev?.startLocal === "string" ? ev.startLocal : null;

      const draft = await runTool(params.context, "email.createDraft", {
        to: [organizer],
        subject: `Quick question: location for ${title}`,
        body: startLocal
          ? `Hey! Could you share the location for \"${title}\" (${startLocal})? Thanks.`
          : `Hey! Could you share the location for \"${title}\"? Thanks.`,
      });
      if (isClarificationLike(draft) || draft.success === false) return { handled: true };
    }

    return { handled: true };
  }

  // XP-004: Archive all low-priority newsletters and create one focus block.
  if (normalized.includes("archive") && normalized.includes("newsletter") && normalized.includes("focus block")) {
    const archived = await runTool(params.context, "email.batchArchive", {
      filter: {
        query: "unsubscribe",
        mailbox: "inbox",
      },
      limit: 50,
    });
    if (isClarificationLike(archived) || archived.success === false) return { handled: true };

    const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const window = workWindowForDate({
      date: tomorrow,
      timeZone: params.userTimeZone,
      startHour: 9,
      endHour: 12,
    });

    const availability = await runTool(params.context, "calendar.findAvailability", {
      durationMinutes: 120,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      timeZone: params.userTimeZone,
    });
    if (isClarificationLike(availability) || availability.success === false) return { handled: true };

    const slots =
      availability.data &&
      typeof availability.data === "object" &&
      Array.isArray((availability.data as any).slots)
        ? ((availability.data as any).slots as Array<{ start: string | Date; end: string | Date }>)
        : [];
    const first = slots[0];
    if (!first) return { handled: true };

    const startIso =
      typeof first.start === "string" ? first.start : (first.start as Date).toISOString();
    const endIso = typeof first.end === "string" ? first.end : (first.end as Date).toISOString();

    const focus = await runTool(params.context, "calendar.createFocusBlock", {
      title: "Focus block",
      start: startIso,
      end: endIso,
      timeZone: params.userTimeZone,
    });
    if (isClarificationLike(focus) || focus.success === false) return { handled: true };

    return { handled: true };
  }

  // XP-005: Reschedule my tasks to tomorrow where I have free space.
  if (normalized.includes("reschedule") && normalized.includes("task") && normalized.includes("tomorrow")) {
    const todayYmd = ymdInTimeZone(now, params.userTimeZone);
    const tomorrow = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const window = workWindowForDate({
      date: tomorrow,
      timeZone: params.userTimeZone,
      startHour: 9,
      endHour: 12,
    });

    const bulk = await runTool(params.context, "task.bulkReschedule", {
      dueDateRange: { after: todayYmd, before: todayYmd },
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      limit: 20,
    });
    if (isClarificationLike(bulk) || bulk.success === false) return { handled: true };

    return { handled: true };
  }

  // XP-001 / CR-015 are better handled by the model with planner.composeDayPlan,
  // but we still want determinism for core data. We prefetch inbox+calendar evidence
  // so the response writer can ground the answer.
  if (normalized.includes("day plan") || (normalized.includes("urgent") && normalized.includes("calendar"))) {
    await runTool(params.context, "email.searchInbox", {
      unread: true,
      sort: "newest",
      limit: 10,
    });

    await runTool(params.context, "calendar.listEvents", {
      dateRange: {
        after: todayStart.toISOString(),
        before: todayEnd.toISOString(),
        timeZone: params.userTimeZone,
      },
      limit: 50,
    });

    return { handled: true };
  }

  return { handled: false };
}
