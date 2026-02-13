# Unified Rule Schema Spec

## Purpose

Define the canonical schema used by guardrails, automations, and preferences.

## Rule Types

- `guardrail`: runtime control plane for mutation safety (`allow/block/approval/transform`).
- `automation`: event-triggered action rules.
- `preference`: user behavior constraints used by planner/skills and optionally automation defaults.

## Canonical Rule (logical model)

```ts
type CanonicalRuleType = "guardrail" | "automation" | "preference";

type CanonicalDecision =
  | "allow"
  | "block"
  | "require_approval"
  | "allow_with_transform";

type CanonicalRule = {
  id: string;
  version: number;
  type: CanonicalRuleType;
  enabled: boolean;
  priority: number; // high first
  createdAt: string; // ISO
  updatedAt: string; // ISO
  expiresAt?: string; // ISO
  disabledUntil?: string; // ISO

  owner: {
    userId: string;
    emailAccountId?: string;
    workspaceId?: string;
  };

  scope: {
    surfaces: Array<"web" | "slack" | "discord" | "telegram" | "system">;
    resources: Array<"email" | "calendar" | "task" | "rule" | "preference">;
  };

  trigger?: CanonicalTrigger; // required for automation
  match: CanonicalMatch;      // required for all

  decision?: CanonicalDecision;         // required for guardrail
  transform?: CanonicalTransform;       // required if allow_with_transform
  actionPlan?: CanonicalActionPlan;     // required for automation
  preferencePatch?: CanonicalPreferencePatch; // required for preference

  source: {
    mode: "ui" | "ai_nl" | "migration" | "system";
    sourceNl?: string; // required when mode=ai_nl
    sourceMessageId?: string;
    sourceConversationId?: string;
    compilerVersion?: string;
    compilerConfidence?: number;
    compilerWarnings?: string[];
  };
};
```

## Trigger Schema

```ts
type CanonicalTrigger =
  | {
      kind: "event";
      eventType:
        | "email.received"
        | "email.labeled"
        | "calendar.event_changed"
        | "calendar.event_created"
        | "task.updated";
      debounceSeconds?: number;
    }
  | {
      kind: "schedule";
      cron: string;
      timeZone: string;
    }
  | {
      kind: "manual";
      entrypoint: "chat" | "ui" | "api";
    };
```

## Match Schema

```ts
type CanonicalMatch = {
  resource: "email" | "calendar" | "task" | "rule" | "preference";
  operation?:
    | "query"
    | "create"
    | "modify"
    | "delete"
    | "send"
    | "schedule"
    | "reschedule"
    | "bulk";
  conditions: Array<{
    field: string; // normalized path, e.g. "email.sender.domain"
    op:
      | "eq"
      | "neq"
      | "in"
      | "not_in"
      | "contains"
      | "regex"
      | "gt"
      | "gte"
      | "lt"
      | "lte"
      | "exists";
    value?: unknown;
  }>;
};
```

## Transform Schema

```ts
type CanonicalTransform = {
  patch: Array<{
    path: string; // json path into canonical mutation payload
    value: unknown;
  }>;
  reason: string;
};
```

## Action Plan Schema

```ts
type CanonicalActionPlan = {
  actions: Array<{
    actionType: string; // canonical capability/action id
    args: Record<string, unknown>;
    idempotencyScope?: "event" | "thread" | "message" | "user";
  }>;
};
```

## Preference Patch Schema

```ts
type CanonicalPreferencePatch = {
  updates: Array<{
    key: string; // e.g. "calendar.workingHours.start"
    value: unknown;
  }>;
};
```

## PDP Input/Output Contract

```ts
type PolicyIntent = {
  actor: {
    userId: string;
    emailAccountId?: string;
    surface: "web" | "slack" | "discord" | "telegram" | "system";
  };
  mutation: {
    resource: "email" | "calendar" | "task" | "rule" | "preference";
    operation: string;
    args: Record<string, unknown>;
  };
  context: {
    provider?: string;
    conversationId?: string;
    channelId?: string;
    threadId?: string;
    messageId?: string;
    source: "skills" | "planner" | "automation" | "scheduled" | "system";
  };
};

type PolicyDecision =
  | { kind: "allow"; matchedRuleId?: string; reason: string }
  | { kind: "block"; matchedRuleId?: string; reason: string; code: string }
  | {
      kind: "require_approval";
      matchedRuleId?: string;
      reason: string;
      approvalPayload: Record<string, unknown>;
    }
  | {
      kind: "allow_with_transform";
      matchedRuleId?: string;
      reason: string;
      transformedMutation: PolicyIntent["mutation"];
    };
```

## Resolution Rules

1. Ignore disabled, expired, or disabled-until-active rules.
2. Filter by owner scope and surface/resource scope.
3. Evaluate `match.conditions`.
4. Sort by:
- `priority` descending
- `updatedAt` descending
- `id` ascending (tie-break stability)
5. First match wins.
6. If no match:
- default decision from baseline policy profile.

## Validation Requirements Before Activation

1. Schema validation (strict, no unknown keys).
2. Semantic validation:
- `decision=allow_with_transform` requires `transform`.
- `type=automation` requires `trigger` and `actionPlan`.
- `type=preference` requires `preferencePatch`.
3. Safety lint:
- no unsupported `resource/operation` pairs
- no invalid transform patch paths
- no action types outside registered capability/action map
4. Conflict lint:
- detect duplicate equal-priority rules with same match scope
- detect impossible conditions

## Audit Requirements

Persist:

1. canonical rule object (versioned)
2. source NL (when present)
3. compiler diagnostics (confidence/warnings)
4. PDP decision log per attempted mutation
5. execution log per attempted mutation
6. approval request + decision linkage for `require_approval`

## Backward Compatibility Contract

Legacy models (`Rule`, `ApprovalPreference`, `CalendarEventPolicy`) are readable during migration but canonical policy decisions are served by PDP.
