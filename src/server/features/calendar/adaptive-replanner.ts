import { ApprovalService } from "@/features/approvals/service";
import {
  findCalendarEventShadowByIdentity,
  finishCalendarPlanRun,
  resolveCalendarEventPolicy,
  startCalendarPlanRun,
} from "@/features/calendar/canonical-state";
import { wasRecentCalendarAction } from "@/features/calendar/action-log";
import { createCalendarProvider } from "@/features/ai/tools/providers/calendar";
import { createDeterministicIdempotencyKey } from "@/server/lib/idempotency";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";

type ChangedCalendarEvent = {
  id?: string;
  provider?: string;
  calendarId?: string;
  iCalUid?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
};

function intervalsOverlap(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}

function isProvider(value: string | undefined): value is "google" | "microsoft" {
  return value === "google" || value === "microsoft";
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

async function hasBlockingConflictForSlot(params: {
  userId: string;
  emailAccountId: string;
  provider: Awaited<ReturnType<typeof createCalendarProvider>>;
  targetEventId: string;
  slot: { start: Date; end: Date };
}): Promise<{ blocked: boolean; reason?: string }> {
  const overlapCandidates = await params.provider.searchEvents("", {
    start: addMinutes(params.slot.start, -1),
    end: addMinutes(params.slot.end, 1),
  });

  const overlaps = overlapCandidates.filter((candidate) => {
    if (candidate.id === params.targetEventId) return false;
    return intervalsOverlap(
      { start: candidate.startTime, end: candidate.endTime },
      { start: params.slot.start, end: params.slot.end },
    );
  });

  for (const overlap of overlaps) {
    const shadow = await findCalendarEventShadowByIdentity({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      provider: overlap.provider,
      calendarId: overlap.calendarId,
      externalEventId: overlap.id,
      iCalUid: overlap.iCalUid,
    });

    const policy = await resolveCalendarEventPolicy({
      userId: params.userId,
      emailAccountId: params.emailAccountId,
      shadowEventId: shadow?.id,
      eventHint: {
        provider: overlap.provider,
        calendarId: overlap.calendarId,
        iCalUid: overlap.iCalUid,
        title: overlap.title,
      },
    });

    if (policy.isProtected || policy.reschedulePolicy === "FIXED") {
      return {
        blocked: true,
        reason: overlap.title
          ? `Conflicts with protected event: ${overlap.title}`
          : "Conflicts with protected calendar time",
      };
    }
  }

  return { blocked: false };
}

export async function runAdaptiveCalendarReplan(params: {
  userId: string;
  emailAccountId: string;
  source: "webhook" | "reconcile";
  changedEvents: ChangedCalendarEvent[];
  logger: Logger;
}): Promise<{
  processed: number;
  autoMoved: number;
  approvalsRequested: number;
  skipped: number;
  blocked: number;
}> {
  if (!params.changedEvents.length) {
    return {
      processed: 0,
      autoMoved: 0,
      approvalsRequested: 0,
      skipped: 0,
      blocked: 0,
    };
  }

  const startedAt = new Date();
  const run = await startCalendarPlanRun({
    userId: params.userId,
    emailAccountId: params.emailAccountId,
    source: `adaptive-${params.source}`,
    trigger: {
      source: params.source,
      changedEvents: params.changedEvents.length,
    },
    input: { changedEvents: params.changedEvents },
  });

  const provider = await createCalendarProvider(
    { id: params.emailAccountId },
    params.userId,
    params.logger,
  );

  const approvalService = new ApprovalService(prisma);

  let processed = 0;
  let autoMoved = 0;
  let approvalsRequested = 0;
  let skipped = 0;
  let blocked = 0;
  const decisions: Array<Record<string, unknown>> = [];

  try {
    for (const changed of params.changedEvents) {
      const eventId = changed.id;
      const calendarId = changed.calendarId;
      if (!eventId || !calendarId) {
        skipped += 1;
        continue;
      }

      const providerName = isProvider(changed.provider) ? changed.provider : undefined;
      if (!providerName) {
        skipped += 1;
        continue;
      }

      const recentlyTouched = await wasRecentCalendarAction({
        userId: params.userId,
        eventId,
        withinMinutes: 5,
      });
      if (recentlyTouched) {
        skipped += 1;
        decisions.push({ eventId, action: "skip_recent_internal_action" });
        continue;
      }

      const currentEvent = await provider.getEvent({ eventId, calendarId });
      if (!currentEvent || currentEvent.isDeleted) {
        skipped += 1;
        decisions.push({ eventId, action: "skip_missing_or_deleted" });
        continue;
      }

      const shadow = await findCalendarEventShadowByIdentity({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        provider: providerName,
        calendarId,
        externalEventId: eventId,
        iCalUid: currentEvent.iCalUid,
      });

      const targetPolicy = await resolveCalendarEventPolicy({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        shadowEventId: shadow?.id,
        eventHint: {
          provider: providerName,
          calendarId,
          iCalUid: currentEvent.iCalUid,
          title: currentEvent.title,
        },
      });

      if (targetPolicy.reschedulePolicy === "FIXED") {
        skipped += 1;
        decisions.push({ eventId, action: "skip_fixed_policy" });
        continue;
      }

      const existingConflict = await hasBlockingConflictForSlot({
        userId: params.userId,
        emailAccountId: params.emailAccountId,
        provider,
        targetEventId: eventId,
        slot: { start: currentEvent.startTime, end: currentEvent.endTime },
      });

      if (!existingConflict.blocked) {
        skipped += 1;
        decisions.push({ eventId, action: "skip_no_blocking_conflict" });
        continue;
      }

      const durationMinutes = Math.max(
        5,
        Math.round((currentEvent.endTime.getTime() - currentEvent.startTime.getTime()) / 60_000),
      );
      const slots = await provider.findAvailableSlots({
        durationMinutes,
        start: addMinutes(currentEvent.endTime, 1),
        end: addMinutes(currentEvent.endTime, 14 * 24 * 60),
      });

      let chosenSlot: { start: Date; end: Date } | null = null;
      for (const slot of slots) {
        const slotCheck = await hasBlockingConflictForSlot({
          userId: params.userId,
          emailAccountId: params.emailAccountId,
          provider,
          targetEventId: eventId,
          slot: { start: slot.start, end: slot.end },
        });
        if (!slotCheck.blocked) {
          chosenSlot = { start: slot.start, end: slot.end };
          break;
        }
      }

      if (!chosenSlot) {
        blocked += 1;
        decisions.push({
          eventId,
          action: "blocked_no_safe_slot",
          reason: existingConflict.reason,
        });
        continue;
      }

      if (targetPolicy.reschedulePolicy === "APPROVAL_REQUIRED") {
        const idempotencyKey = createDeterministicIdempotencyKey(
          "calendar-auto-reschedule-approval",
          params.userId,
          eventId,
          chosenSlot.start.toISOString(),
          chosenSlot.end.toISOString(),
        );

        const approval = await approvalService.createRequest({
          userId: params.userId,
          provider: "system",
          externalContext: { source: "calendar-adaptive-replanner" },
          requestPayload: {
            actionType: "calendar_auto_reschedule",
            description: `Move \"${currentEvent.title}\" to avoid a protected-time conflict`,
            tool: "modify",
            args: {
              resource: "calendar",
              ids: [eventId],
              changes: {
                calendarId,
                start: chosenSlot.start.toISOString(),
                end: chosenSlot.end.toISOString(),
                mode: "single",
              },
            },
          },
          idempotencyKey,
          expiresInSeconds: 24 * 60 * 60,
        });

        approvalsRequested += 1;
        decisions.push({
          eventId,
          action: "approval_requested",
          approvalId: approval.id,
          from: {
            start: currentEvent.startTime.toISOString(),
            end: currentEvent.endTime.toISOString(),
          },
          to: {
            start: chosenSlot.start.toISOString(),
            end: chosenSlot.end.toISOString(),
          },
        });

        params.logger.info("Adaptive replan approval requested", {
          userId: params.userId,
          approvalId: approval.id,
          eventId,
          calendarId,
        });

        processed += 1;
        continue;
      }

      await provider.updateEvent({
        calendarId,
        eventId,
        input: {
          start: chosenSlot.start,
          end: chosenSlot.end,
          mode: "single",
        },
      });

      autoMoved += 1;
      processed += 1;
      decisions.push({
        eventId,
        action: "auto_moved",
        from: {
          start: currentEvent.startTime.toISOString(),
          end: currentEvent.endTime.toISOString(),
        },
        to: {
          start: chosenSlot.start.toISOString(),
          end: chosenSlot.end.toISOString(),
        },
      });

      if (targetPolicy.notifyOnAutoMove) {
        params.logger.info("Adaptive replan auto-moved event", {
          userId: params.userId,
          eventId,
          calendarId,
          toStart: chosenSlot.start.toISOString(),
          toEnd: chosenSlot.end.toISOString(),
        });
      }
    }

    await finishCalendarPlanRun({
      runId: run.id,
      status: processed > 0 || autoMoved > 0 || approvalsRequested > 0 ? "SUCCESS" : "NOOP",
      decisions,
      result: { processed, autoMoved, approvalsRequested, skipped, blocked },
      startedAt: run.createdAt,
    });

    return { processed, autoMoved, approvalsRequested, skipped, blocked };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await finishCalendarPlanRun({
      runId: run.id,
      status: "FAILED",
      decisions,
      result: { processed, autoMoved, approvalsRequested, skipped, blocked },
      error: errorMessage,
      startedAt,
    });
    throw error;
  }
}
