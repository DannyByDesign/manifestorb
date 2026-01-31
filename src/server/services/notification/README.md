# Notification Service

The centralized "Factory" for all push notifications in the platform.

## Architecture

This service is the **Writer** vs the **Carrier** (ChannelRouter). It focuses purely on *content generation*.

## Key Components

### `generator.ts` (`NotificationGenerator`)
- **Role**: Uses a fast LLM (Groq/Gemini) to generate conversational summaries.
- **Inputs**: `NotificationContext` (Email, Calendar, Task).
- **Outputs**: A single string (under 20 words).
- **Features**:
  - **Timeout Race**: If LLM is slow (>10s), falls back to static string.
  - **Type Safety**: Supports `email`, `calendar`, `system`, `task`.

## Usage

```typescript
import { generateNotification } from "@/server/services/notification/generator";

const text = await generateNotification({
  type: "email",
  source: "Uber",
  title: "Receipt",
  detail: "$45.23",
  importance: "medium"
}, { emailAccount });

// Result: "Uber just charged you $45.23."
```

## Directory Structure
This is a sibling to `src/server/services/email`. It is NOT inside the email module.
