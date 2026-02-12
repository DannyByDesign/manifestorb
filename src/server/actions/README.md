# Server Actions

This directory contains Next.js Server Actions built with `next-safe-action`. These are authenticated, type-safe functions that can be called directly from client components.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Action Layer                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Client Component                                                   │
│         │                                                            │
│         ▼                                                            │
│   Server Action (authenticated, validated)                           │
│         │                                                            │
│         ▼                                                            │
│   Feature Module / Database                                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Action Clients

Defined in `safe-action.ts`:

| Client | Use Case | Auth Required | Binding |
|--------|----------|---------------|---------|
| `actionClient` | Email account operations | User + Email ownership | `emailAccountId` |
| `actionClientUser` | User-level operations | User only | None |
| `adminActionClient` | Admin operations | Admin role | None |

### Example Usage

```typescript
// In an action file
import { actionClient, actionClientUser } from "@/actions/safe-action";

// Requires email account binding
export const archiveThreadAction = actionClient
  .metadata({ name: "archiveThread" })
  .inputSchema(z.object({ threadId: z.string() }))
  .action(async ({ ctx, parsedInput }) => {
    // ctx.emailAccountId, ctx.userId available
  });

// User-level only
export const updateAiSettingsAction = actionClientUser
  .metadata({ name: "updateAiSettings" })
  .inputSchema(saveAiSettingsBody)
  .action(async ({ ctx, parsedInput }) => {
    // ctx.userId available
  });
```

## File Structure

Each feature has an action file and a validation file:

```
actions/
├── safe-action.ts         # Action client definitions
├── [feature].ts           # Action implementations
├── [feature].validation.ts # Zod schemas
└── __tests__/             # Test files
```

## Action Files Reference

### Email Operations
| File | Purpose |
|------|---------|
| `mail.ts` | Archive, trash, mark read, create filters |
| `mail-bulk-action.ts` | Bulk email operations |
| `generate-reply.ts` | AI-generated email replies |
| `reply-tracking.ts` | Follow-up detection |

### Automation
| File | Purpose |
|------|---------|
| `rule.ts` | Create, update, delete automation rules |
| `ai-rule.ts` | AI-powered rule suggestions |

### Settings & User
| File | Purpose |
|------|---------|
| `settings.ts` | AI settings, digest config |
| `user.ts` | Profile, signature, writing style |
| `email-account.ts` | Email account management |
| `email-account-cookie.ts` | Account switching |

### Integrations
| File | Purpose |
|------|---------|
| `calendar.ts` | Calendar operations |

### Organization
| File | Purpose |
|------|---------|
| `organization.ts` | Team management |
| `sso.ts` | SSO configuration |
| `permissions.ts` | Permission management |

### Features
| File | Purpose |
|------|---------|
| `knowledge.ts` | Knowledge base management |
| `group.ts` | Contact groups |
| `cold-email.ts` | Cold email detection settings |
| `unsubscriber.ts` | Newsletter unsubscribe |
| `whitelist.ts` | Sender whitelist |
| `meeting-briefs.ts` | Meeting preparation |

### Admin & Stats
| File | Purpose |
|------|---------|
| `admin.ts` | Admin-only operations |
| `stats.ts` | Analytics and statistics |
| `report.ts` | Generate reports |
| `assess.ts` | Assessment operations |
| `announcements.ts` | System announcements |

### Misc
| File | Purpose |
|------|---------|
| `api-key.ts` | API key management |
| `webhook.ts` | Webhook configuration |
| `onboarding.ts` | User onboarding flow |
| `error-messages.ts` | Error message management |

## Validation Files

Each `.validation.ts` file exports Zod schemas:

```typescript
// rule.validation.ts
export const createRuleBody = z.object({
  name: z.string().min(1),
  actions: z.array(actionSchema),
  conditions: conditionSchema,
});
```

## How Actions Are Consumed

### 1. Direct Client Import
```typescript
"use client";
import { createRuleAction } from "@/actions/rule";

// Call the action
const result = await createRuleAction(emailAccountId, { name: "My Rule", ... });
```

### 2. By AI Tools
The AI agent uses actions through the tools and providers. Rule mutations can go through server actions or the **rules** tool (polymorphic) and rules portal APIs (`/api/rules`, `/api/rules/[id]`).

### 3. By API Routes
Some API routes call actions internally:
```typescript
// app/api/scheduled-actions/execute/route.ts
// Executes scheduled actions using the action layer
```

## Error Handling

Actions use `SafeError` for user-facing errors:

```typescript
import { SafeError } from "@/server/lib/error";

if (!authorized) {
  throw new SafeError("You don't have permission to do this");
}
```

Other errors are logged and reported to Sentry, returning a generic message.

## Adding a New Action

1. **Create validation schema** in `[feature].validation.ts`:
   ```typescript
   export const myActionBody = z.object({ ... });
   ```

2. **Create action** in `[feature].ts`:
   ```typescript
   export const myAction = actionClient
     .metadata({ name: "myAction" })
     .inputSchema(myActionBody)
     .action(async ({ ctx, parsedInput }) => { ... });
   ```

3. **Test**: Add tests in `__tests__/[feature].test.ts`

## Context Available in Actions

### `actionClient` (email-bound)
```typescript
ctx: {
  logger,           // Scoped logger
  userId,           // User ID
  userEmail,        // User email
  session,          // Auth session
  emailAccountId,   // Bound email account
  emailAccount,     // Email account data
  provider,         // "google" | "microsoft"
}
```

### `actionClientUser` (user-only)
```typescript
ctx: {
  logger,
  userId,
  userEmail,
}
```

### `adminActionClient`
```typescript
ctx: {
  logger,
}
```

## Validation Status

All actions are:
- Authenticated via WorkOS AuthKit session
- Input-validated via Zod schemas
- Logged with request IDs
- Error-tracked via Sentry
- Ownership-verified for email operations

The actions layer is production-ready and properly integrated with the rest of the application.
