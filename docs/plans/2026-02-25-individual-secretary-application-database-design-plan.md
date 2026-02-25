# Individual Secretary Application Database Design Plan

Date: 2026-02-25  
Status: Proposed (implementation-ready blueprint)

## 1) Objective

Design the first real **application-layer** database model for the AI secretary product while preserving the existing runtime/session/task foundation.

This plan is based on product requirements clarified by the user and is intended to be executed on:

1. **Supabase Postgres** for data storage.
2. **Railway** for service hosting.

## 2) Product Constraints (Locked)

1. Product scope is **individual users only** (no teams/workspaces in v1).
2. Tenancy is **single-tenant per individual account**.
3. Authentication is via **WorkOS**.
4. Launch channels are messaging-first: **SMS/WhatsApp/Telegram/iMessage** (Twilio-first where supported, additional provider adapters allowed).
5. Conversation history should be **unified across channels** for the same user, including future app-native surfaces.
6. No CRM model in v1; channel identities are sufficient.
7. Core user object is the ongoing conversation with the secretary.
8. Secretary must capture user preferences/directives from natural language.
9. Default approval guardrail: **sending emails requires approval**.
10. MVP integrations: **Gmail + Google Calendar** at user level.
11. Memory system is deferred, but schema must lay groundwork now.
12. Retention policy baseline changed to **90 days** for non-memory operational history.
13. Pricing target is **$10/month** with **>=60% gross margin**.
14. Limits are enforced **per user** (no workspace limits).
15. Billing/analytics/compliance are not primary build targets in this phase.
16. Basic table-stakes security is mandatory now, including **RLS**.
17. Do not introduce workspace/team tables in v1; keep schema strictly user-scoped.

## 3) Current Baseline in Repo (What Already Exists)

The system already has runtime durability tables in Supabase migrations:

1. `runtime_sessions`, `runtime_turns`, `runtime_session_events`
2. `runtime_tasks`, `runtime_task_attempts`, `runtime_task_events`, `runtime_task_dead_letters`
3. `runtime_idempotency_keys`
4. `runtime_outbound_deliveries`, `runtime_delivery_events`
5. `twilio_session_mappings`

These are runtime-engine tables, not complete product-domain tables.

## 4) Design Principle

Do not rewrite runtime tables now.  
Add application-domain tables that map users/conversations/preferences/integrations/limits onto the runtime layer.

## 5) Target Application Schema (v1)

### 5.1 Identity + User Mapping

1. `app_users`
2. `app_user_channel_identities`

`app_users` should be canonical identity keyed by WorkOS subject.

Suggested columns:

1. `id uuid primary key`
2. `workos_subject text unique not null`
3. `email text`
4. `phone_e164 text`
5. `timezone text not null default 'UTC'`
6. `status text not null default 'active'`
7. `plan_code text not null default 'starter_10_usd'`
8. `created_at timestamptz not null default now()`
9. `updated_at timestamptz not null default now()`

`app_user_channel_identities` maps channel identity -> user:

1. `id uuid primary key`
2. `app_user_id uuid not null references app_users(id) on delete cascade`
3. `channel text not null`
4. `external_user_key text not null`
5. `verified_at timestamptz`
6. `metadata jsonb not null default '{}'::jsonb`
7. unique `(channel, external_user_key)`

### 5.2 Unified Conversation Model

1. `app_conversations`
2. `app_conversation_channels`
3. `app_runtime_session_links`

`app_conversations` is product-level conversation timeline per user.

`app_conversation_channels` allows multiple channel conversation IDs to map to one unified conversation.

`app_runtime_session_links` connects runtime session IDs to app conversations for continuity and diagnostics.

### 5.3 Preferences + Directive Groundwork (Memory Foundation)

1. `app_user_preferences`
2. `app_user_directives`

`app_user_preferences` is structured key-value preferences.

`app_user_directives` stores natural-language instructions, normalized metadata, active flags, and source references.

This provides the storage foundation for future long-term memory extraction/retrieval without implementing memory engine logic now.

### 5.4 Action Policies + Approval Queue

1. `app_action_policies`
2. `app_action_approvals`

Seed policy default:

1. `action_type='send_email' => requires_approval=true`
2. all other action types default to `false` unless changed by user preference.

### 5.5 Integrations (User-Scoped)

1. `app_integrations`
2. `app_integration_credentials`
3. `app_integration_sync_state`

Provider values for MVP:

1. `google_gmail`
2. `google_calendar`

### 5.6 Usage + Limits

1. `billing_usage_ledger` (append-only)
2. `billing_user_monthly_usage` (rollup/read model)
3. `billing_user_limits` (enforcement config)

Per-user enforcement only.

## 6) Retention and Data Lifecycle (Updated to 90 Days)

1. Raw operational conversation artifacts older than **90 days** are eligible for purge.
2. Runtime/session/task event logs older than **90 days** are eligible for purge.
3. For compaction-aware history: pre-compaction segments are purge-eligible at 90 days, while the current active conversation tail remains available until a later compaction supersedes it.
4. Future memory records (when implemented) are intended to persist long-term.

Implementation note:

1. Add explicit retention jobs and retention policy table to avoid hardcoded TTL logic.
2. Retention actions should be soft-delete compatible where possible (`deleted_at`) before hard purge.

## 7) Security Baseline (MVP Mandatory)

1. Enable Row Level Security on all new `app_*` and `billing_*` tables.
2. Use service-role for backend writes from Railway services.
3. Enforce user-bound read/write by `app_user_id`.
4. Prevent users from mutating usage counters directly (`billing_user_monthly_usage`, `billing_usage_ledger` write-protected to service role).
5. Restrict policy/approval updates to authenticated user scope.

## 8) Cost and Limit Strategy for $10 Plan

Given:

1. Revenue target per user: `$10/month`
2. Gross margin target: `>=60%`

Then model/infra variable COGS target should be `<= $4/month` per user.
Operational target for this first version: keep AI-runtime spend near `<= $3.25/month` to preserve buffer for infra overhead and variance.

Conservative initial limits:

1. hard monthly model cost cap: `3.00` to `3.50` USD
2. warning threshold: `80%` of hard cap
3. per-user proactive/cron budget partition: reserve `15%` to `25%` of model budget for proactive jobs and heartbeats
4. per-user proactive job cap: configured in `billing_user_limits`
5. token caps are derived as secondary controls from observed model mix and enforced at request admission

These values should be tunable per user via `billing_user_limits` but seeded globally for v1.

## 9) Implementation Phases

### Phase 1: Identity + User Mapping

Migration file:

1. `infra/supabase/migrations/<timestamp>_app_identity.sql`

Create:

1. `app_users`
2. `app_user_channel_identities`

### Phase 2: Unified Conversations

Migration file:

1. `infra/supabase/migrations/<timestamp>_app_conversations.sql`

Create:

1. `app_conversations`
2. `app_conversation_channels`
3. `app_runtime_session_links`

### Phase 3: Preferences + Directives

Migration file:

1. `infra/supabase/migrations/<timestamp>_app_preferences_and_directives.sql`

Create:

1. `app_user_preferences`
2. `app_user_directives`

### Phase 4: Action Policies + Approval Queue

Migration file:

1. `infra/supabase/migrations/<timestamp>_app_action_policies_and_approvals.sql`

Create and seed defaults:

1. `app_action_policies`
2. `app_action_approvals`

### Phase 5: Integrations

Migration file:

1. `infra/supabase/migrations/<timestamp>_app_integrations.sql`

Create:

1. `app_integrations`
2. `app_integration_credentials`
3. `app_integration_sync_state`

### Phase 6: Usage + Limits

Migration file:

1. `infra/supabase/migrations/<timestamp>_billing_usage_and_limits.sql`

Create:

1. `billing_usage_ledger`
2. `billing_user_monthly_usage`
3. `billing_user_limits`

Add rollup job to update monthly usage materialization.

### Phase 7: Retention + Security Hardening

Migration file:

1. `infra/supabase/migrations/<timestamp>_retention_and_rls.sql`

Apply:

1. 90-day retention framework
2. RLS policies
3. restricted write grants for billing counters

## 10) Service Wiring Changes (After Schema)

1. Resolve WorkOS subject -> `app_user_id` in control-plane boundary.
2. Replace channel-only principal assumptions for canonical user identity.
3. Ensure inbound channel messages map through `app_user_channel_identities`.
4. Write usage/cost rows per terminal runtime result.
5. Enforce per-user limits before model invocation and before proactive jobs.

## 11) Non-Goals for This Plan

1. Full long-term memory retrieval engine implementation.
2. Stripe subscription system and invoice lifecycle.
3. Enterprise workspace/org abstraction.
4. Analytics warehouse/event BI layer.
5. Advanced compliance program workflows.

## 12) Definition of Done

1. New `app_*` + `billing_*` schema is deployed with migration coverage.
2. Conversation identity is unified per user across channels.
3. Preferences/directives persistence exists for future memory extraction.
4. Approval queue exists with `send_email` guarded by default.
5. Gmail/Calendar connection metadata persists at user scope.
6. Per-user limits are enforceable and usage is ledgered.
7. Retention policy is implemented with **90-day** default for operational history.
8. RLS baseline prevents cross-user data leakage.
