# Server-Side Architecture (`src/server`)

This directory contains the core backend logic, separated into distinct architectural layers.

## Directory Structure

| Directory | Purpose |
| :--- | :--- |
| **`agent/`** | **The Executive Brain.** Contains `executor.ts` which runs the AI agent loop (Plan -> Act -> Observation). It decides *which* tool to call based on user intent. |
| **`channels/`** | **The Nervous System (Router).** Handles inbound/outbound messages from external platforms (Slack, Discord, Web). Manages the "Active Channel" state. |
| **`conversations/`** | **Memory storage.** Manages `Conversation` and `ConversationMessage` records. Handles deduplication of inbound messages. |
| **`summaries/`** | **Long-term Memory.** Compression service that summarizes older conversations to maintain context without blowing up token context windows. |
| **`integrations/`** | **The Limbs.** External API wrappers. Contains `google` (Gmail), `microsoft` (Outlook), `ai` (LLM Models), and `qstash`. |
| **`services/`** | **The Business Engines.** Reusable business logic completely decoupled from the API layer. Includes `unsubscriber`, `email` sync, and `notification`. |
| **`approvals/`** | **Human-in-the-loop.** Service for managing `ApprovalRequest`s. Allows certain AI actions (like "Delete Email") to pause and wait for human confirmation. |
| **`auth/`** | **Authentication.** NextAuth.js configuration and helpers. |
| **`db/`** | **Data Persistence.** Prisma Client initialization and Schema. |
| **`privacy/`** | **Safety Filter.** Logic for PII redaction and retention policies. |
| **`utils/`** | **Shared Toolkit.** Extensive collection of helper functions (String manipulation, Date parsing, specific AI utilities). |
| **`scripts/`** | **Maintenance.** Standalone scripts for ops or data migration. |
