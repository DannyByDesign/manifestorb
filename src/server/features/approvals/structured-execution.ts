import prisma from "@/server/db/client";
import { createCalendarProvider } from "@/server/features/ai/tools/providers/calendar";
import type { Logger } from "@/server/lib/logger";
import {
  TaskEnergyLevel,
  TaskPriority,
  TaskReschedulePolicy,
  TaskStatus,
  TaskTimePreference,
} from "@/generated/prisma/enums";

type JsonRecord = Record<string, unknown>;

export type StructuredToolName = "create" | "modify";

export interface StructuredApprovalExecutionInput {
  tool: StructuredToolName;
  args: JsonRecord;
  userId: string;
  emailAccountId: string;
  logger: Logger;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asTaskStatus(value: unknown): TaskStatus | undefined {
  return Object.values(TaskStatus).includes(value as TaskStatus)
    ? (value as TaskStatus)
    : undefined;
}

function asTaskPriority(value: unknown): TaskPriority | undefined {
  return Object.values(TaskPriority).includes(value as TaskPriority)
    ? (value as TaskPriority)
    : undefined;
}

function asTaskEnergyLevel(value: unknown): TaskEnergyLevel | undefined {
  return Object.values(TaskEnergyLevel).includes(value as TaskEnergyLevel)
    ? (value as TaskEnergyLevel)
    : undefined;
}

function asTaskTimePreference(value: unknown): TaskTimePreference | undefined {
  return Object.values(TaskTimePreference).includes(value as TaskTimePreference)
    ? (value as TaskTimePreference)
    : undefined;
}

function asTaskReschedulePolicy(value: unknown): TaskReschedulePolicy | undefined {
  return Object.values(TaskReschedulePolicy).includes(value as TaskReschedulePolicy)
    ? (value as TaskReschedulePolicy)
    : undefined;
}

function normalizeCalendarAttendees(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const email = asString((entry as JsonRecord).email);
        return email;
      }
      return undefined;
    })
    .filter((entry): entry is string => Boolean(entry));
}

async function executeCalendarCreate(input: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
  data: JsonRecord;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const provider = await createCalendarProvider(
    { id: input.emailAccountId },
    input.userId,
    input.logger,
  );

  const start = parseDate(input.data.start);
  const end = parseDate(input.data.end);
  if (!start || !end) {
    return { success: false, error: "Calendar event requires start and end." };
  }

  const created = await provider.createEvent({
    calendarId: asString(input.data.calendarId),
    input: {
      title: asString(input.data.title) ?? "Untitled event",
      description: asString(input.data.description),
      location: asString(input.data.location),
      start,
      end,
      attendees: normalizeCalendarAttendees(input.data.attendees),
      allDay: asBoolean(input.data.allDay),
      isRecurring: asBoolean(input.data.isRecurring),
      recurrenceRule: asString(input.data.recurrenceRule),
      timeZone: asString(input.data.timeZone),
      addGoogleMeet: true,
    },
  });

  return { success: true, data: created };
}

async function executeTaskCreate(input: {
  userId: string;
  data: JsonRecord;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const title = asString(input.data.title);
  if (!title) {
    return { success: false, error: "Task title is required." };
  }

  const task = await prisma.task.create({
    data: {
      userId: input.userId,
      title,
      description: asString(input.data.description) ?? null,
      durationMinutes:
        typeof input.data.durationMinutes === "number" ? input.data.durationMinutes : null,
      status: asTaskStatus(input.data.status) ?? TaskStatus.PENDING,
      priority: asTaskPriority(input.data.priority) ?? TaskPriority.NONE,
      energyLevel: asTaskEnergyLevel(input.data.energyLevel) ?? null,
      preferredTime: asTaskTimePreference(input.data.preferredTime) ?? null,
      dueDate: parseDate(input.data.dueDate) ?? null,
      startDate: parseDate(input.data.startDate) ?? null,
      isAutoScheduled: asBoolean(input.data.isAutoScheduled) ?? true,
      scheduleLocked: asBoolean(input.data.scheduleLocked) ?? false,
      reschedulePolicy:
        asTaskReschedulePolicy(input.data.reschedulePolicy) ?? TaskReschedulePolicy.FLEXIBLE,
      scheduledStart: parseDate(input.data.scheduledStart) ?? null,
      scheduledEnd: parseDate(input.data.scheduledEnd) ?? null,
    },
  });

  return { success: true, data: task };
}

async function executeCalendarModify(input: {
  userId: string;
  emailAccountId: string;
  logger: Logger;
  ids: string[];
  changes: JsonRecord;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (input.ids.length === 0) {
    return { success: false, error: "No calendar event ids provided." };
  }

  const provider = await createCalendarProvider(
    { id: input.emailAccountId },
    input.userId,
    input.logger,
  );
  const calendarId = asString(input.changes.calendarId);
  const modeRaw = asString(input.changes.mode);
  const mode = modeRaw === "series" || modeRaw === "single" ? modeRaw : undefined;

  const results = await Promise.all(
    input.ids.map(async (eventId) =>
      provider.updateEvent({
        calendarId,
        eventId,
        input: {
          title: asString(input.changes.title),
          description: asString(input.changes.description),
          location: asString(input.changes.location),
          start: parseDate(input.changes.start),
          end: parseDate(input.changes.end),
          attendees: normalizeCalendarAttendees(input.changes.attendees),
          allDay: asBoolean(input.changes.allDay),
          isRecurring: asBoolean(input.changes.isRecurring),
          recurrenceRule: asString(input.changes.recurrenceRule),
          timeZone: asString(input.changes.timeZone),
          mode,
        },
      }),
    ),
  );

  return {
    success: true,
    data: {
      updatedCount: results.length,
      events: results,
    },
  };
}

async function executeTaskModify(input: {
  ids: string[];
  changes: JsonRecord;
}): Promise<{ success: boolean; data?: unknown; error?: string }> {
  if (input.ids.length === 0) {
    return { success: false, error: "No task ids provided." };
  }

  const result = await prisma.task.updateMany({
    where: { id: { in: input.ids } },
    data: {
      title: asString(input.changes.title),
      description: asString(input.changes.description),
      status: asTaskStatus(input.changes.status),
      priority: asTaskPriority(input.changes.priority),
      energyLevel: asTaskEnergyLevel(input.changes.energyLevel),
      preferredTime: asTaskTimePreference(input.changes.preferredTime),
      dueDate: parseDate(input.changes.dueDate),
      startDate: parseDate(input.changes.startDate),
      scheduledStart: parseDate(input.changes.scheduledStart ?? input.changes.start),
      scheduledEnd: parseDate(input.changes.scheduledEnd ?? input.changes.end),
      scheduleLocked: asBoolean(input.changes.scheduleLocked),
      reschedulePolicy: asTaskReschedulePolicy(input.changes.reschedulePolicy),
      isAutoScheduled: asBoolean(input.changes.isAutoScheduled),
      lastScheduled: new Date(),
    },
  });

  return { success: true, data: { updatedCount: result.count } };
}

export async function executeStructuredApprovalAction(
  input: StructuredApprovalExecutionInput,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const resource = asString(input.args.resource);
  const data = asRecord(input.args.data);
  const changes = asRecord(input.args.changes);
  const ids = asStringArray(input.args.ids);

  if (input.tool === "create") {
    if (resource === "calendar") {
      return executeCalendarCreate({
        userId: input.userId,
        emailAccountId: input.emailAccountId,
        logger: input.logger,
        data,
      });
    }
    if (resource === "task") {
      return executeTaskCreate({ userId: input.userId, data });
    }
    return { success: false, error: `Unsupported create resource: ${resource ?? "unknown"}` };
  }

  if (resource === "calendar") {
    return executeCalendarModify({
      userId: input.userId,
      emailAccountId: input.emailAccountId,
      logger: input.logger,
      ids,
      changes,
    });
  }
  if (resource === "task") {
    return executeTaskModify({ ids, changes });
  }

  return { success: false, error: `Unsupported modify resource: ${resource ?? "unknown"}` };
}
