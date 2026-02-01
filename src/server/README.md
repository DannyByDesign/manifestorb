# Server-Side Architecture

The `src/server` directory contains the backend logic of the application, organized into distinct layers to separate concerns.

## Directory Structure

### 1. `integrations/` (The "Connector" Layer)
Handlers for external APIs and the AI brain.
-   **`ai/`**: The Core Agent, Tools, and Rule Engine.
-   **`google/`**: Gmail and Google Calendar clients.
-   **`microsoft/`**: Outlook and Microsoft Graph clients.
-   **`slack/`, `discord/`, `telegram/`**: Chat platform adapters.

### 2. `services/` (The "Business Logic" Layer)
Pure domain logic, decoupled from specific API transports or AI tooling.
-   **`email/`**: Provider-agnostic email operations.
-   **`unsubscriber/`**: Rules, Reporting, and Bulk Actions.
-   **`notification/`**: Push notifications and approval flows.
-   **`billing/`**: Stripe integration.

### 3. `utils/` (The "Shared" Layer)
Helper functions and shared utilities.
-   **`ai/`**: Low-level LLM calls and prompt templates.
-   **`logger`**: Structured logging.

### 4. `db/` (The "Data" Layer)
Prisma client and schema definitions.
-   `client.ts`: The Prisma client instance.

### 5. `api/` (The "Transport" Layer)
Found in `src/app/api` (Next.js App Router), but relies heavily on `server/` logic.
-   **`routers/`**: tRPC routers (if applicable).
-   **`webhooks/`**: Incoming webhook handlers.
