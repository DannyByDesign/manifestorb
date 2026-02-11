# Notification Service

The centralized system for all in-app and push notifications.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Notification Flow                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Trigger (Agent, Rule, System)                                      │
│              │                                                       │
│              ▼                                                       │
│   createInAppNotification()                                          │
│              │                                                       │
│              ├──► DB: InAppNotification (claimedAt=null)             │
│              │                                                       │
│              └──► QStash: Schedule fallback (15s delay)              │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              Delivery Path                                   │   │
│   │                                                              │   │
│   │   Fallback worker (fires at 15s) pushes to Slack/Discord/   │   │
│   │   Telegram when notification is still unclaimed.             │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Components

**Actionable approvals** use **secure signed action tokens** (`features/approvals/action-token.ts`) for approval links (push/email); triage and send approvals are gated by these tokens.

### `create.ts` - Notification Factory
Creates notifications and schedules the fallback worker.

```typescript
import { createInAppNotification } from "@/features/notifications/create";

await createInAppNotification({
    userId: "user_123",
    title: "New Email from Sarah",
    body: "RE: Q3 Report - Can we discuss tomorrow?",
    type: "info",
    metadata: { source: "email", threadId: "thread_456" },
    dedupeKey: "email-thread_456" // Prevents duplicates
});
```

### `generator.ts` - AI Content Generator
Uses a fast LLM to generate conversational notification text.

```typescript
import { generateNotification } from "@/features/notifications/generator";

const text = await generateNotification({
    type: "email",
    source: "Uber",
    title: "Receipt",
    detail: "$45.23",
    importance: "medium"
}, { emailAccount });

// Result: "Uber just charged you $45.23."
```

## API Endpoints

### Notification History
```
GET /api/notifications
```
Returns the last 50 notifications for the authenticated user.

**Response:**
```json
{
    "notifications": [
        {
            "id": "notif_123",
            "title": "New message from Sarah",
            "body": "RE: Q3 Report",
            "type": "info",
            "isRead": false,
            "createdAt": "2026-01-29T10:30:00Z"
        }
    ]
}
```

### Unread Count
```
GET /api/notifications/unread-count
```
Returns the count of unread notifications. Useful for badges.

**Response:**
```json
{ "count": 5 }
```

### Mark as Read
```
POST /api/notifications/[id]/read
```
Marks a single notification as read.

**Response:**
```json
{ "success": true }
```

### Mark All as Read
```
POST /api/notifications/read-all
```
Marks all unread notifications as read.

**Response:**
```json
{ "success": true, "markedAsRead": 12 }
```

### Fallback Push (Internal)
```
POST /api/notifications/fallback
```
Called by QStash after 15 seconds. Pushes unclaimed notifications to Slack/Discord.
Protected by QStash signature verification.

## Database Model

```prisma
model InAppNotification {
    id        String   @id
    userId    String
    
    // Content
    title     String
    body      String?
    type      String   // "info", "warning", "success", "error", "approval"
    metadata  Json?    // { source, actionUrl, approvalId, etc. }
    
    // State Flags
    isRead          Boolean   @default(false)
    readAt          DateTime?
    claimedAt       DateTime? // Web app fetched it
    pushedToSurface Boolean   @default(false)
    pushedAt        DateTime?
    
    // Deduplication
    dedupeKey       String?   @unique
}
```

## Deduplication Strategy

Fallback delivery claim is handled atomically:

1. **Fallback checks**: Only pushes if `claimedAt IS NULL AND pushedToSurface = false`
2. **Atomic update**: Uses `updateMany` with conditions to prevent double-push

This ensures only one fallback worker instance claims and delivers a notification.

## Notes

Web polling is currently disabled. Real-time in-app updates should be implemented with a push channel (SSE/WebSocket) in a future pass.
