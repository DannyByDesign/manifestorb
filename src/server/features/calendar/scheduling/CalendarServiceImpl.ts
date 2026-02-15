import type { CalendarEvent } from "@/features/calendar/event-types";
import prisma from "@/server/db/client";
import type { Logger } from "@/server/lib/logger";
import { areIntervalsOverlapping } from "./date-utils";
import type { BatchConflictCheck, CalendarService } from "./CalendarService";
import type { Conflict, TimeSlot } from "./types";
import { CalendarProviderAdapter } from "./adapters/CalendarProviderAdapter";

interface EventCache {
  events: CalendarEvent[];
  startDay: number;
  endDay: number;
  calendarIds: string[];
  timestamp: number;
}

export class CalendarServiceImpl implements CalendarService {
  private cache: EventCache | null = null;
  private readonly CACHE_TTL = 30 * 60 * 1000;
  private readonly adapter: CalendarProviderAdapter;

  constructor(emailAccountId: string, logger: Logger) {
    this.adapter = new CalendarProviderAdapter(emailAccountId, logger);
  }

  private getDayTimestamp(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  private getWeekTimestamp(date: Date, start: boolean): number {
    const d = new Date(date);
    const day = d.getDay();
    const diff = start ? -day : 6 - day;
    d.setDate(d.getDate() + diff);
    return this.getDayTimestamp(d);
  }

  private isCacheValid(start: Date, end: Date, calendarIds: string[]): boolean {
    if (!this.cache) return false;

    const cacheAge = Date.now() - this.cache.timestamp;
    if (cacheAge > this.CACHE_TTL) return false;

    const sortedRequestedIds = [...calendarIds].sort();
    const sortedCachedIds = [...this.cache.calendarIds].sort();
    const sameCalendars =
      JSON.stringify(sortedRequestedIds) === JSON.stringify(sortedCachedIds);

    const requestedStartWeek = this.getWeekTimestamp(start, true);
    const requestedEndWeek = this.getWeekTimestamp(end, false);
    const hasDateRange =
      this.cache.startDay <= requestedStartWeek &&
      this.cache.endDay >= requestedEndWeek;

    return sameCalendars && hasDateRange;
  }

  async findConflicts(
    slot: TimeSlot,
    selectedCalendarIds: string[],
    userId: string,
    excludeTaskId?: string,
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    const events = await this.getEvents(
      slot.start,
      slot.end,
      selectedCalendarIds,
    );

    for (const event of events) {
      if (
        areIntervalsOverlapping(
          { start: slot.start, end: slot.end },
          { start: event.startTime, end: event.endTime },
        )
      ) {
        conflicts.push({
          type: "calendar_event",
          start: event.startTime,
          end: event.endTime,
          title: event.title,
          source: {
            type: "calendar",
            id: event.id,
          },
        });
        return conflicts;
      }
    }

    const scheduledTasks = await prisma.task.findMany({
      where: {
        isAutoScheduled: true,
        scheduledStart: { not: null },
        scheduledEnd: { not: null },
        id: excludeTaskId ? { not: excludeTaskId } : undefined,
        userId,
      },
    });

    for (const task of scheduledTasks) {
      if (
        task.scheduledStart &&
        task.scheduledEnd &&
        areIntervalsOverlapping(
          { start: slot.start, end: slot.end },
          { start: task.scheduledStart, end: task.scheduledEnd },
        )
      ) {
        conflicts.push({
          type: "task",
          start: task.scheduledStart,
          end: task.scheduledEnd,
          title: task.title,
          source: {
            type: "task",
            id: task.id,
          },
        });
      }
    }

    return conflicts;
  }

  private async getEvents(
    start: Date,
    end: Date,
    selectedCalendarIds: string[],
  ): Promise<CalendarEvent[]> {
    if (this.isCacheValid(start, end, selectedCalendarIds)) {
      return this.cache!.events.filter(
        (event) => event.startTime <= end && event.endTime >= start,
      );
    }

    const startDay = new Date(this.getWeekTimestamp(start, true));
    const endDay = new Date(this.getWeekTimestamp(end, false));
    endDay.setDate(endDay.getDate() + 1);

    const events = await this.adapter.listEvents(startDay, endDay, selectedCalendarIds);

    this.cache = {
      events,
      startDay: startDay.getTime(),
      endDay: endDay.getTime(),
      calendarIds: selectedCalendarIds,
      timestamp: Date.now(),
    };

    return events.filter((event) => event.startTime <= end && event.endTime >= start);
  }

  async findBatchConflicts(
    slots: { slot: TimeSlot; taskId: string }[],
    selectedCalendarIds: string[],
    userId: string,
    excludeTaskId?: string,
  ): Promise<BatchConflictCheck[]> {
    if (!slots || slots.length === 0) {
      return [];
    }

    const startTime = slots.reduce(
      (earliest, { slot }) => (slot.start < earliest ? slot.start : earliest),
      slots[0].slot.start,
    );
    const endTime = slots.reduce(
      (latest, { slot }) => (slot.end > latest ? slot.end : latest),
      slots[0].slot.end,
    );

    const events = await this.getEvents(startTime, endTime, selectedCalendarIds);

    const scheduledTasks = await prisma.task.findMany({
      where: {
        isAutoScheduled: true,
        scheduledStart: { not: null },
        scheduledEnd: { not: null },
        id: excludeTaskId ? { not: excludeTaskId } : undefined,
        userId,
      },
    });

    return slots.map(({ slot, taskId }) => {
      const conflicts: Conflict[] = [];

      for (const event of events) {
        if (
          areIntervalsOverlapping(
            { start: slot.start, end: slot.end },
            { start: event.startTime, end: event.endTime },
          )
        ) {
          conflicts.push({
            type: "calendar_event",
            start: event.startTime,
            end: event.endTime,
            title: event.title,
            source: {
              type: "calendar",
              id: event.id,
            },
          });
          break;
        }
      }

      if (conflicts.length === 0) {
        for (const task of scheduledTasks) {
          if (
            task.scheduledStart &&
            task.scheduledEnd &&
            areIntervalsOverlapping(
              { start: slot.start, end: slot.end },
              { start: task.scheduledStart, end: task.scheduledEnd },
            )
          ) {
            conflicts.push({
              type: "task",
              start: task.scheduledStart,
              end: task.scheduledEnd,
              title: task.title,
              source: {
                type: "task",
                id: task.id,
              },
            });
          }
        }
      }

      return { slot, taskId, conflicts };
    });
  }
}
