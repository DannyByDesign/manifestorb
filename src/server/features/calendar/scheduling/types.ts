export type EnergyLevel = "HIGH" | "MEDIUM" | "LOW";
export type TimePreference = "MORNING" | "AFTERNOON" | "EVENING";
export type TaskPriority = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type ReschedulePolicy = "FIXED" | "FLEXIBLE" | "APPROVAL_REQUIRED";

export type SchedulingTask = {
  id: string;
  userId: string;
  title: string;
  durationMinutes: number | null;
  status: TaskStatus;
  priority?: TaskPriority | null;
  energyLevel?: EnergyLevel | null;
  preferredTime?: TimePreference | null;
  dueDate?: Date | null;
  startDate?: Date | null;
  scheduleLocked?: boolean;
  isAutoScheduled?: boolean;
  scheduledStart?: Date | null;
  scheduledEnd?: Date | null;
  scheduleScore?: number | null;
  reschedulePolicy?: ReschedulePolicy | null;
};

export type SchedulingSettings = {
  workHourStart: number;
  workHourEnd: number;
  workDays: number[];
  bufferMinutes: number;
  selectedCalendarIds: string[];
  timeZone: string;
  groupByProject: boolean;
};

export type TimeSlot = {
  start: Date;
  end: Date;
  score: number;
  conflicts: Conflict[];
  energyLevel: EnergyLevel | null;
  isWithinWorkHours: boolean;
  hasBufferTime: boolean;
};

export type Conflict = {
  type: "calendar_event" | "task";
  start: Date;
  end: Date;
  title: string;
  source: {
    type: "calendar" | "task";
    id: string;
  };
};

export type SlotScore = {
  total: number;
  factors: Record<string, number>;
};
