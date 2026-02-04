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
│   │              Race: Who claims first?                         │   │
│   │                                                              │   │
│   │   Web App (polls every 3s)    vs    Fallback (fires at 15s) │   │
│   │   If visible: claims it              If unclaimed: push to   │   │
│   │   Shows toast in UI                  Slack/Discord/Telegram  │   │
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

### Poll for New Notifications
```
GET /api/notifications/poll
```
Claims and returns unclaimed notifications. Used by the web app for real-time updates.
Only polls when the browser tab is visible (prevents claiming while user is AFK).

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

The race between web app and fallback worker is handled atomically:

1. **Web app claims**: Sets `claimedAt` timestamp
2. **Fallback checks**: Only pushes if `claimedAt IS NULL AND pushedToSurface = false`
3. **Atomic update**: Uses `updateMany` with conditions to prevent race

This ensures notifications go to **either** web OR surfaces, never both.

## Visibility Detection

The web app only polls when the browser tab is visible:

```typescript
// From use-notification-poll.ts
const [isVisible, setIsVisible] = useState(true);

useEffect(() => {
    const handleVisibilityChange = () => {
        setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
}, []);

// Only poll when visible
useSWR(isVisible ? "/api/notifications/poll" : null, fetcher);
```

If the user switches tabs, polling stops, and the fallback will push to Slack/Discord after 15 seconds.
