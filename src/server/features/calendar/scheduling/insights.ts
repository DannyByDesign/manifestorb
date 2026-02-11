import prisma from "@/server/db/client";
import { Prisma } from "@/generated/prisma/client";

/**
 * Analyze the user's calendar events from the past 30 days
 * and update SchedulingInsights with learned patterns.
 */
export async function updateSchedulingInsights(userId: string): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const events = await prisma.calendarActionLog.findMany({
    where: {
      userId,
      action: "create",
      createdAt: { gte: thirtyDaysAgo },
      // Prisma JSON filters use JsonNull; plain `null` is not assignable.
      payload: { not: Prisma.JsonNull },
    },
    select: { payload: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  if (events.length < 5) {
    return;
  }

  const durations: number[] = [];
  const startHours: number[] = [];
  const endHours: number[] = [];
  const workDaySet = new Set<number>();
  const gaps: number[] = [];

  let prevEnd: Date | null = null;

  for (const event of events) {
    const payload = event.payload as Record<string, unknown> | null;
    if (!payload) continue;

    const start = payload.start ? new Date(payload.start as string) : null;
    const end = payload.end ? new Date(payload.end as string) : null;

    if (start && end) {
      const durationMin = (end.getTime() - start.getTime()) / (1000 * 60);
      if (durationMin > 0 && durationMin < 480) {
        durations.push(durationMin);
      }
      startHours.push(start.getHours() + start.getMinutes() / 60);
      endHours.push(end.getHours() + end.getMinutes() / 60);
      workDaySet.add(start.getDay());

      if (prevEnd) {
        const gapMin = (start.getTime() - prevEnd.getTime()) / (1000 * 60);
        if (gapMin > 0 && gapMin < 120) gaps.push(gapMin);
      }
      prevEnd = end;
    }
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
  const medianDuration = sorted[Math.floor(sorted.length / 2)] ?? 30;

  const avgStart = startHours.reduce((a, b) => a + b, 0) / startHours.length;
  const avgEnd = endHours.reduce((a, b) => a + b, 0) / endHours.length;
  const avgBuffer = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;

  await prisma.schedulingInsights.upsert({
    where: { userId },
    update: {
      avgMeetingDurationMin: Math.round(avgDuration),
      medianMeetingDurationMin: Math.round(medianDuration),
      avgBufferMin: avgBuffer !== null ? Math.round(avgBuffer) : undefined,
      actualWorkHourStart: Math.round(avgStart * 2) / 2,
      actualWorkHourEnd: Math.round(avgEnd * 2) / 2,
      activeWorkDays: Array.from(workDaySet).sort(),
      lastAnalyzedAt: new Date(),
    },
    create: {
      userId,
      avgMeetingDurationMin: Math.round(avgDuration),
      medianMeetingDurationMin: Math.round(medianDuration),
      avgBufferMin: avgBuffer !== null ? Math.round(avgBuffer) : undefined,
      actualWorkHourStart: Math.round(avgStart * 2) / 2,
      actualWorkHourEnd: Math.round(avgEnd * 2) / 2,
      activeWorkDays: Array.from(workDaySet).sort(),
      lastAnalyzedAt: new Date(),
    },
  });

  await suggestPreferenceUpdates(userId);
}

/**
 * If the user's actual work patterns differ from TaskPreference, create a suggestion notification.
 */
export async function suggestPreferenceUpdates(userId: string): Promise<void> {
  const [insights, preferences] = await Promise.all([
    prisma.schedulingInsights.findUnique({ where: { userId } }),
    prisma.taskPreference.findUnique({ where: { userId } }),
  ]);

  if (!insights || !preferences) return;
  if (insights.actualWorkHourStart == null || insights.actualWorkHourEnd == null) return;

  const diffs: string[] = [];

  if (insights.actualWorkHourStart < preferences.workHourStart - 1) {
    diffs.push(
      `You often start as early as ${formatHour(insights.actualWorkHourStart)}, but your settings say ${formatHour(preferences.workHourStart)}.`,
    );
  }
  if (insights.actualWorkHourEnd > preferences.workHourEnd + 1) {
    diffs.push(
      `You often work until ${formatHour(insights.actualWorkHourEnd)}, but your settings say ${formatHour(preferences.workHourEnd)}.`,
    );
  }

  if (insights.activeWorkDays.length > 0) {
    const prefDays = new Set(preferences.workDays);
    const extraDays = insights.activeWorkDays.filter((d) => !prefDays.has(d));
    if (extraDays.length > 0) {
      const dayNames = extraDays.map(
        (d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d],
      );
      diffs.push(
        `You also have meetings on ${dayNames.join(", ")}, which aren't in your work days.`,
      );
    }
  }

  if (diffs.length === 0) return;

  const { createInAppNotification } = await import("@/server/features/notifications/create");
  await createInAppNotification({
    userId,
    title: "Your schedule settings might be outdated",
    body: `Based on your recent calendar:\n${diffs.join("\n")}\n\nWant me to update your settings?`,
    type: "info",
    dedupeKey: `schedule-suggestion-${userId}-${new Date().toISOString().slice(0, 10)}`,
    metadata: {
      type: "preference_suggestion",
      suggestions: {
        workHourStart: Math.floor(insights.actualWorkHourStart),
        workHourEnd: Math.ceil(insights.actualWorkHourEnd),
        workDays: insights.activeWorkDays,
        bufferMinutes:
          insights.avgBufferMin != null
            ? Math.round(insights.avgBufferMin)
            : preferences.bufferMinutes,
      },
    },
  });
}

function formatHour(h: number): string {
  const hour = Math.floor(h);
  const minutes = Math.round((h - hour) * 60);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return minutes > 0
    ? `${h12}:${String(minutes).padStart(2, "0")} ${ampm}`
    : `${h12} ${ampm}`;
}
