import { inboxTriageTodaySkill } from "./inbox-triage-today";
import { inboxBulkNewsletterCleanupSkill } from "./inbox-bulk-newsletter-cleanup";
import { inboxSubscriptionControlSkill } from "./inbox-subscription-control";
import { inboxSnoozeOrDeferSkill } from "./inbox-snooze-or-defer";
import { inboxThreadSummarizeActionsSkill } from "./inbox-thread-summarize-actions";
import { inboxDraftReplySkill } from "./inbox-draft-reply";
import { inboxScheduleSendSkill } from "./inbox-schedule-send";
import { inboxFollowupGuardSkill } from "./inbox-followup-guard";
import { calendarFindAvailabilitySkill } from "./calendar-find-availability";
import { calendarScheduleFromContextSkill } from "./calendar-schedule-from-context";
import { calendarRescheduleWithConstraintsSkill } from "./calendar-reschedule-with-constraints";
import { calendarFocusTimeDefenseSkill } from "./calendar-focus-time-defense";
import { calendarWorkingHoursOooSkill } from "./calendar-working-hours-ooo";
import { calendarBookingPageSetupSkill } from "./calendar-booking-page-setup";
import { calendarMeetingLoadRebalanceSkill } from "./calendar-meeting-load-rebalance";
import { dailyPlanInboxCalendarSkill } from "./daily-plan-inbox-calendar";
import { inboxMarkReadUnreadSkill } from "./inbox-mark-read-unread";
import { inboxLabelManagementSkill } from "./inbox-label-management";
import { inboxMoveOrSpamControlSkill } from "./inbox-move-or-spam-control";
import { inboxReplyOrForwardSendSkill } from "./inbox-reply-or-forward-send";
import { inboxFilterManagementSkill } from "./inbox-filter-management";
import { calendarEventDeleteOrCancelSkill } from "./calendar-event-delete-or-cancel";
import { calendarAttendeeManagementSkill } from "./calendar-attendee-management";
import { calendarRecurringSeriesManagementSkill } from "./calendar-recurring-series-management";
import { calendarWorkingLocationManagementSkill } from "./calendar-working-location-management";
import { multiActionInboxCalendarSkill } from "./multi-action-inbox-calendar";
import { rulePlaneManagementSkill } from "./rule-plane-management";

export const baselineSkills = [
  inboxTriageTodaySkill,
  inboxBulkNewsletterCleanupSkill,
  inboxSubscriptionControlSkill,
  inboxSnoozeOrDeferSkill,
  inboxThreadSummarizeActionsSkill,
  inboxDraftReplySkill,
  inboxScheduleSendSkill,
  inboxFollowupGuardSkill,
  calendarFindAvailabilitySkill,
  calendarScheduleFromContextSkill,
  calendarRescheduleWithConstraintsSkill,
  calendarFocusTimeDefenseSkill,
  calendarWorkingHoursOooSkill,
  calendarBookingPageSetupSkill,
  calendarMeetingLoadRebalanceSkill,
  dailyPlanInboxCalendarSkill,
  inboxMarkReadUnreadSkill,
  inboxLabelManagementSkill,
  inboxMoveOrSpamControlSkill,
  inboxReplyOrForwardSendSkill,
  inboxFilterManagementSkill,
  calendarEventDeleteOrCancelSkill,
  calendarAttendeeManagementSkill,
  calendarRecurringSeriesManagementSkill,
  calendarWorkingLocationManagementSkill,
  multiActionInboxCalendarSkill,
  rulePlaneManagementSkill,
] as const;
