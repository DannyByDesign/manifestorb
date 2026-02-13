# Capability Coverage Matrix (Baseline + Planner)

Status: Drafted, executable baseline  
Scope: Inbox + Calendar primitives exposed by current runtime

## Email

1. Search/read: covered by baseline + planner (`email.search*`, `email.get*`)
2. Archive/trash/spam/move/labels/read-state: covered by baseline + planner
3. Subscription control (unsubscribe/block): covered by baseline + planner
4. Draft/reply/forward/send/schedule-send: covered by baseline + planner
5. Filters list/create/delete: covered by baseline + planner

## Calendar

1. Availability/search/list/get: covered by baseline + planner
2. Create/update/delete/reschedule: covered by baseline + planner
3. Attendee and recurring mode management: covered by baseline + planner
4. Working hours/location/OOO/focus/booking schedule: covered by baseline + planner

## Cross-Surface Planning

1. Daily planning (`planner.composeDayPlan`): covered by baseline + planner
2. Multi-action planning (`planner.compileMultiActionPlan`): covered by baseline + planner

## Gaps to Track

1. Complex calendar optimization across large dependency sets:
   currently handled via generic planning, no dedicated optimizer yet.
2. Provider-specific exceptional operations not represented in registry:
   must be added before claiming support.
