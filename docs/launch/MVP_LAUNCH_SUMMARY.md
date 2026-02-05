# MVP Launch Summary (Google-only)

System of record: Beads epic `amodel-b17`.

## Scope
- Gmail, Google Calendar, Google Drive, Google Contacts
- Web app + sidecar (Slack/Discord/Telegram + background jobs)
- Environments: local, staging, production

## Go / No-Go Criteria
GO if all are true:
1) All Beads child issues under `amodel-b17` are closed.
2) Staging smoke tests pass for Google MVP flows (Gmail draft/send approvals, Calendar scheduling + conflicts, Drive filing + webhook watch, notifications fallback).
3) Webhook/cron verification complete for Gmail/Calendar/Drive watch renewals and scheduled-actions execute (QStash signature + CRON_SECRET).
4) Sidecar verification complete: `/surfaces/inbound`, `/notify`, job scheduler running, connectors enabled as intended.
5) Prod env vars validated for main app + sidecar (core env, OAuth/PubSub, QStash/CRON, Redis, feature flags).
6) Error monitoring configured or explicitly waived for MVP (Sentry/PostHog decision recorded).

NO-GO if any are false or any P0 launch issues remain open.
