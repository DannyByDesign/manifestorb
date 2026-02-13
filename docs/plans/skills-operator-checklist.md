# Skills Runtime Operator Checklist

Last updated: 2026-02-13

Use this checklist for manual parity verification in staging/prod-like environments.

## Inbox

- [ ] Triage today: run "triage my inbox" and confirm prioritized list is returned.
- [ ] Newsletter cleanup: archive batch action executes and reports item counts.
- [ ] Subscription control: unsubscribe path works or returns deterministic fallback prompt.
- [ ] Mark read/unread: confirm state mutation and response accuracy.
- [ ] Label management: add/remove label actions behave correctly.
- [ ] Move/spam controls: folder move and spam actions execute without false success.
- [ ] Draft lifecycle: create/update/delete draft and confirm provider-side state.
- [ ] Reply/forward/send: sent actions honor approval policy and return deterministic blocked reason when required.
- [ ] Filter management: create/list/delete filter actions return stable outcomes.
- [ ] Scheduled send: reject past timestamps, accept future timestamps, and return schedule id.

## Calendar

- [ ] Availability search returns candidate slots for scoped window.
- [ ] Schedule from context creates event with attendees and expected duration.
- [ ] Reschedule with constraints returns either new slot or deterministic no-slot reason.
- [ ] Delete/cancel supports single vs series mode and enforces policy precheck.
- [ ] Attendee management updates attendees and confirms event id/mode.
- [ ] Recurring series management applies requested mode safely.
- [ ] Working hours/out-of-office updates return deterministic prompts when required slots are missing.
- [ ] Focus time defense blocks windows outside configured working hours.
- [ ] Booking page setup persists booking link.
- [ ] Working location reports unsupported environments explicitly (no false success).

## Cross-surface / Multi-action

- [ ] Multi-action request executes sub-actions sequentially with per-step status.
- [ ] Mixed success returns partial summary with action-by-action outcomes.
- [ ] Policy-blocked sub-action does not block unrelated safe sub-actions.

## Policy / Approval

- [ ] Mutating steps emit policy precheck before execution.
- [ ] Approval-required actions return blocked result with alternative suggestion.
- [ ] Non-mutating steps execute without approval checks.

## Telemetry

- [ ] `skill.route.completed` includes semantic confidence, routed families, unresolved entities.
- [ ] `skill.execution.completed` includes step graph size, policy block count, repair attempts, outcome.
- [ ] `skill.action.completed` includes step capability, item count, policy decision.

