import type { Conflict, TimeSlot } from "./types";

export type BatchConflictCheck = {
  slot: TimeSlot;
  taskId: string;
  conflicts: Conflict[];
};

export interface CalendarService {
  findConflicts(
    slot: TimeSlot,
    selectedCalendarIds: string[],
    userId: string,
    excludeTaskId?: string,
  ): Promise<Conflict[]>;

  findBatchConflicts(
    slots: { slot: TimeSlot; taskId: string }[],
    selectedCalendarIds: string[],
    userId: string,
    excludeTaskId?: string,
  ): Promise<BatchConflictCheck[]>;
}
