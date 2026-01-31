# Server Services (`src/server/services`)

This directory contains the **Business Logic Engines**. These modules process data, execute rules, and manage the state of the application. They are distinct from "Integrations" (which just fetch data) and "API Routes" (which just serve it).

## 1. `unsubscriber/` (The "Ferrari Engine")
This is the largest and most complex service module (>60 files). It handles the automated "assistant" logic.

-   **`rule.ts`**: CRUD for User Rules. The core logic for "Where does this email go?".
-   **`execute.ts`**: Logic for actually performing the Unsubscribe action (Header parsing, Link clicking).
-   **`cold-email.ts`**: LLM-based detection of sales outreach.
-   **`report.ts`**: Generates the weekly "Executive Summary" and "User Persona".
-   **`mail-bulk-action.ts`**: Logic for "Archive All from Sender".
-   **`onboarding.ts`**: Processes initial account setup and user survey data.
-   **`calendar.ts`**: Manages Calendar connection *settings* (not the events themselves).

## 2. `email/` (The Sync Engine)
-   **`process-history.ts`**: The core loop. Receives a `historyId` from a Webhook, fetches the delta, updates the DB, and triggers Rules.
-   **`watch-manager.ts`**: Ensures push notifications remain active (renewing every 24h).

## 3. `notification/` (The Push Engine)
-   **`generator.ts`**: Uses a fast LLM to generate conversational, short push notifications ("You spent $45 at Uber").
