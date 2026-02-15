import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

type CalendarRow = {
  id: string;
  calendarId: string;
  name: string;
  description: string | null;
  primary: boolean;
  isEnabled: boolean;
  createdAt: Date;
  provider: string;
  connectionEmail: string;
};

type EnsureCalendarSelectionInvariantArgs = {
  userId: string;
  emailAccountId: string;
  logger?: Logger;
  source?: string;
};

export type CalendarSelectionInvariantResult = {
  userId: string;
  emailAccountId: string;
  enabledCalendarIds: string[];
  selectedCalendarIds: string[];
  changed: boolean;
};

const CALENDAR_ID_NOISE_PATTERNS = [
  /#holiday@group\.v\.calendar\.google\.com$/i,
  /#contacts@group\.v\.calendar\.google\.com$/i,
  /holiday\.calendar\.google\.com/i,
];

const CALENDAR_NAME_NOISE_KEYS = new Set([
  "birthdays",
  "birthday",
  "holidays",
  "unitedstatesholidays",
  "usholidays",
  "contacts",
]);

function normalize(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function isLikelyNoisyCalendar(calendar: {
  calendarId: string;
  name: string;
  description?: string | null;
  provider?: string;
}): boolean {
  if (CALENDAR_ID_NOISE_PATTERNS.some((pattern) => pattern.test(calendar.calendarId))) {
    return true;
  }

  const nameKey = normalize(calendar.name);
  if (CALENDAR_NAME_NOISE_KEYS.has(nameKey)) {
    return true;
  }

  const calendarIdKey = normalize(calendar.calendarId);
  if (calendarIdKey.includes("birthday") || calendarIdKey.includes("holiday")) {
    if (
      calendar.provider === "google" ||
      calendar.provider === "microsoft" ||
      calendar.calendarId.includes("@group.v.calendar.google.com")
    ) {
      return true;
    }
  }

  const descriptionKey = normalize(calendar.description);
  if (
    descriptionKey.includes("contactbirthday") ||
    descriptionKey.includes("holidaycalendar")
  ) {
    return true;
  }

  return false;
}

function scoreCalendarForSelection(calendar: CalendarRow): number {
  let score = 0;

  if (calendar.primary) score += 100;
  if (calendar.calendarId.toLowerCase() === "primary") score += 80;
  if (calendar.connectionEmail && calendar.calendarId === calendar.connectionEmail) {
    score += 70;
  }
  if (!isLikelyNoisyCalendar(calendar)) score += 10;

  return score;
}

function pickPreferredCalendar(calendars: CalendarRow[]): CalendarRow | null {
  if (calendars.length === 0) return null;

  const ranked = [...calendars].sort((a, b) => {
    const scoreDiff = scoreCalendarForSelection(b) - scoreCalendarForSelection(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return ranked[0] ?? null;
}

export async function ensureCalendarSelectionInvariant({
  userId,
  emailAccountId,
  logger,
  source = "unspecified",
}: EnsureCalendarSelectionInvariantArgs): Promise<CalendarSelectionInvariantResult> {
  const connections = await prisma.calendarConnection.findMany({
    where: {
      emailAccountId,
      isConnected: true,
      emailAccount: { userId },
    },
    select: {
      id: true,
      provider: true,
      email: true,
      calendars: {
        select: {
          id: true,
          calendarId: true,
          name: true,
          description: true,
          primary: true,
          isEnabled: true,
          createdAt: true,
        },
      },
    },
  });

  if (connections.length === 0) {
    const existingPreferences = await prisma.taskPreference.findUnique({
      where: { userId },
      select: { selectedCalendarIds: true },
    });
    return {
      userId,
      emailAccountId,
      enabledCalendarIds: [],
      selectedCalendarIds: (existingPreferences?.selectedCalendarIds ?? []).filter(Boolean),
      changed: false,
    };
  }

  const enableIds = new Set<string>();
  const disableIds = new Set<string>();
  const promotePrimaryIds = new Set<string>();

  const calendars: CalendarRow[] = connections.flatMap((connection) =>
    connection.calendars.map((calendar) => ({
      ...calendar,
      provider: connection.provider,
      connectionEmail: connection.email,
    })),
  );

  for (const connection of connections) {
    const connectionCalendars = calendars.filter(
      (calendar) =>
        connection.calendars.some((candidate) => candidate.id === calendar.id),
    );
    if (connectionCalendars.length === 0) continue;

    const noisyCalendars = connectionCalendars.filter((calendar) =>
      isLikelyNoisyCalendar(calendar),
    );
    const nonNoisyCalendars = connectionCalendars.filter(
      (calendar) => !isLikelyNoisyCalendar(calendar),
    );

    if (nonNoisyCalendars.length > 0) {
      for (const noisyCalendar of noisyCalendars) {
        if (noisyCalendar.isEnabled) {
          disableIds.add(noisyCalendar.id);
        }
      }
    }

    const enablePool = nonNoisyCalendars.length > 0 ? nonNoisyCalendars : connectionCalendars;
    const enabledInPool = enablePool.filter(
      (calendar) => calendar.isEnabled || enableIds.has(calendar.id),
    );

    if (enabledInPool.length === 0) {
      const preferred = pickPreferredCalendar(enablePool);
      if (preferred) enableIds.add(preferred.id);
    }

    const primaryPool = nonNoisyCalendars.length > 0 ? nonNoisyCalendars : enablePool;
    const hasPrimary = primaryPool.some((calendar) => calendar.primary);
    if (!hasPrimary) {
      const preferred = pickPreferredCalendar(primaryPool);
      if (preferred) promotePrimaryIds.add(preferred.id);
    }
  }

  if (disableIds.size > 0) {
    await prisma.calendar.updateMany({
      where: { id: { in: Array.from(disableIds) } },
      data: { isEnabled: false },
    });
  }

  if (enableIds.size > 0) {
    await prisma.calendar.updateMany({
      where: { id: { in: Array.from(enableIds) } },
      data: { isEnabled: true },
    });
  }

  if (promotePrimaryIds.size > 0) {
    await Promise.all(
      Array.from(promotePrimaryIds).map((id) =>
        prisma.calendar.update({
          where: { id },
          data: { primary: true },
        }),
      ),
    );
  }

  const enableIdSet = new Set(enableIds);
  const disableIdSet = new Set(disableIds);

  const calendarsAfter = calendars.map((calendar) => ({
    ...calendar,
    isEnabled: enableIdSet.has(calendar.id)
      ? true
      : disableIdSet.has(calendar.id)
        ? false
        : calendar.isEnabled,
  }));

  const enabledNonNoisyCalendars = calendarsAfter.filter(
    (calendar) => calendar.isEnabled && !isLikelyNoisyCalendar(calendar),
  );
  const enabledCalendars = calendarsAfter.filter((calendar) => calendar.isEnabled);
  const selectionPool =
    enabledNonNoisyCalendars.length > 0 ? enabledNonNoisyCalendars : enabledCalendars;

  const orderedSelectionPool = [...selectionPool].sort((a, b) => {
    const scoreDiff = scoreCalendarForSelection(b) - scoreCalendarForSelection(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const orderedSelectedCalendarIds = Array.from(
    new Set(orderedSelectionPool.map((calendar) => calendar.calendarId).filter(Boolean)),
  );

  const existingPreferences = await prisma.taskPreference.findUnique({
    where: { userId },
    select: { selectedCalendarIds: true },
  });
  const currentSelectedCalendarIds = (existingPreferences?.selectedCalendarIds ?? []).filter(
    Boolean,
  );
  const allowedSelectedIdSet = new Set(orderedSelectedCalendarIds);
  let nextSelectedCalendarIds = currentSelectedCalendarIds.filter((id) =>
    allowedSelectedIdSet.has(id),
  );

  if (nextSelectedCalendarIds.length === 0 && orderedSelectedCalendarIds.length > 0) {
    nextSelectedCalendarIds = orderedSelectedCalendarIds;
  }

  const selectedChanged = !arraysEqual(
    currentSelectedCalendarIds,
    nextSelectedCalendarIds,
  );
  if (selectedChanged) {
    await prisma.taskPreference.upsert({
      where: { userId },
      update: { selectedCalendarIds: nextSelectedCalendarIds },
      create: { userId, selectedCalendarIds: nextSelectedCalendarIds },
    });
  }

  const changed =
    selectedChanged ||
    enableIds.size > 0 ||
    disableIds.size > 0 ||
    promotePrimaryIds.size > 0;

  if (changed) {
    logger?.info("Calendar selection invariant repaired", {
      source,
      userId,
      emailAccountId,
      enabledAdded: enableIds.size,
      enabledRemoved: disableIds.size,
      promotedPrimary: promotePrimaryIds.size,
      selectedCalendarIds: nextSelectedCalendarIds,
    });
  }

  return {
    userId,
    emailAccountId,
    enabledCalendarIds: enabledCalendars.map((calendar) => calendar.calendarId),
    selectedCalendarIds: nextSelectedCalendarIds,
    changed,
  };
}
