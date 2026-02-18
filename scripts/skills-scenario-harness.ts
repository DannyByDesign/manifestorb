type ScenarioExpectation = {
  expectedSkill: string;
  expectedOutcome: "success" | "blocked" | "clarify";
  requiredSlots?: string[];
};

type Scenario = {
  id: string;
  message: string;
  expectation: ScenarioExpectation;
};

const scenarios: Scenario[] = [
  {
    id: "inbox_triage_today",
    message: "Triage my inbox for today and show urgent threads.",
    expectation: { expectedSkill: "inbox_triage_today", expectedOutcome: "success" },
  },
  {
    id: "inbox_bulk_newsletter_cleanup",
    message: "Clean up newsletters from this week and archive them.",
    expectation: { expectedSkill: "inbox_bulk_newsletter_cleanup", expectedOutcome: "success" },
  },
  {
    id: "inbox_subscription_control",
    message: "Unsubscribe me from Acme promos and block future sends.",
    expectation: { expectedSkill: "inbox_subscription_control", expectedOutcome: "success" },
  },
  {
    id: "inbox_mark_read",
    message: "Mark thread_id t123 as read.",
    expectation: {
      expectedSkill: "inbox_mark_read_unread",
      expectedOutcome: "success",
      requiredSlots: ["thread_ids", "read"],
    },
  },
  {
    id: "inbox_filter_management",
    message: "Create a filter for receipts@vendor.com and auto-archive.",
    expectation: {
      expectedSkill: "inbox_filter_management",
      expectedOutcome: "success",
      requiredSlots: ["sender_or_domain"],
    },
  },
  {
    id: "calendar_find_availability",
    message: "Find 45 minute availability tomorrow morning.",
    expectation: { expectedSkill: "calendar_find_availability", expectedOutcome: "success" },
  },
  {
    id: "calendar_schedule_from_context",
    message: "Schedule a meeting with sara@acme.com at 2026-02-17T16:00:00Z.",
    expectation: {
      expectedSkill: "calendar_schedule_from_context",
      expectedOutcome: "success",
      requiredSlots: ["participants", "start"],
    },
  },
  {
    id: "calendar_cancel_event",
    message: "Cancel event_id ev_555 for this instance only.",
    expectation: {
      expectedSkill: "calendar_event_delete_or_cancel",
      expectedOutcome: "success",
      requiredSlots: ["event_id", "mode"],
    },
  },
  {
    id: "calendar_working_hours",
    message: "Set my working hours to 9am-5pm weekdays.",
    expectation: { expectedSkill: "calendar_working_hours_ooo", expectedOutcome: "success" },
  },
  {
    id: "multi_action_cross_surface",
    message: "Archive newsletters and reschedule tomorrow standup, then draft reply to Sarah.",
    expectation: {
      expectedSkill: "multi_action_inbox_calendar",
      expectedOutcome: "success",
      requiredSlots: ["composite_actions"],
    },
  },
];

function run(): void {
  const report = {
    generatedAt: new Date().toISOString(),
    scenarioCount: scenarios.length,
    scenarios,
    instructions:
      "Replay each message through /api/chat or surfaces ingress and compare observed skill/outcome with expectation.",
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

run();
