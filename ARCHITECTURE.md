# Amodel Architecture & "The Map"

> **Purpose**: This document is the definitive guide for engineers and AI agents to navigate the Amodel codebase. It maps high-level features to specific directories and files, explaining **where to go** to build or modify functionality.

---

## 1. High-Level System Design

Amodel is a **Next.js** application with a heavy **Server-Side** focus. It functions as an intelligent email client and automation engine.

### Data Flow for a User Request

1.  **User Interface** (`src/app`): User clicks "Draft Reply" or types in Chat.
2.  **API Route** (`src/app/api`): Request hits a Next.js API endpoint.
3.  **Service Layer** (`src/server/services`): Business logic (auth check, billing check) runs.
4.  **Integration Layer** (`src/server/integrations`):
    *   **AI**: Calls OpenAI/Anthropic to generate content (`src/server/integrations/ai`).
    *   **Provider**: Calls Gmail/Outlook API to fetch data or sync changes (`src/server/integrations/google`).
5.  **Database** (`src/server/db`): State is saved to Postgres via Prisma.

---

## 2. Directory Structure Map

### `src/app` (The Frontend & API)
*   **`src/app/api`**: The backend API routes.
    *   `src/app/api/ai`: Endpoints for chat, drafting, analysis.
    *   `src/app/api/auth`: NextAuth/BetterAuth handlers.
    *   `src/app/api/webhooks`: Incoming webhooks (Gmail push, Stripe).
*   **`src/app/(dashboard)`**: The main logged-in UI pages.
*   **`components/`**: React UI components (Buttons, Inputs, localized views).

### `surfaces/` (The Sidecar Service)
*   **Node.js App**: A standalone process that connects to real-time chat APIs (Slack Socket Mode, Discord Gateway, Telegram Polling).
*   **Role**:
    *   Ingests messages + fetches thread history (for context).
    *   Forwards normalized messages via HTTP to `src/app/api/surfaces/inbound`.
    *   Renders interactive elements (Buttons) for Approvals.

### `src/server` (The Backend Core)
This is where 90% of the logic lives.

#### `src/server/agent` (The Executive Brain)
*   **`executor.ts`**: The **Unified Agent Executor**.
    *   Orchestrates the "One-Shot" agent for Surfaces.
    *   Injects **Personal Instructions** (`about`) and **Conversation Context** (`history`).
    *   INTERCEPTS sensitive tool calls (`modify`, `create`) to generate **Approval Requests**.
*   **`context-manager.ts`**: The **Recursive Memory (RLM)** layer.
    *   Retrieves relevant past `ConversationMessage` rows (Deduplicated).
    *   Injects long-term `MemoryFact` items ("About Me").
    *   Compresses history using `ConversationSummary`.

#### `src/server/channels` (The Router)
*   **`router.ts`**: The logic that receives messages from Surfaces, authenticates the user (via Magic Link token logic), and calls the Executor.

#### `src/server/integrations` (The "Hands")
*   **`src/server/integrations/ai`**: **The AI Brain.**
    *   `assistant/`: The Chatbot logic (`chat.ts`).
    *   `tools/`: **Agentic Tools** (The hands of the AI).
        *   `query.ts` (Search), `modify.ts` (Archive/Label), `create.ts` (Drafts).
        *   `providers/`: The bridge between AI tools and identifying Gmail vs Outlook.
    *   `rule/`: AI logic for generating automation rules from text.
    *   `reply/`: Logic for drafting replies and follow-ups.
    *   `categorize-sender/`: Logic for classifying newsletters vs personal mail.
*   **`src/server/integrations/google`**: **Gmail Plumbing.**
    *   Raw API handling for Gmail (OAuth, Message parsing, Label sync).
    *   `message.ts`, `thread.ts`, `history.ts`.
*   **`src/server/integrations/microsoft`**: **Outlook Plumbing.**
    *   Graph API handling (`message.ts`, `folders.ts`).

#### `src/server/services` (The Business Logic)
*   **`src/server/services/unsubscriber`**: (Legacy name) Core domain logic.
    *   `rule.ts`: CRUD for automation rules.
    *   `engine.ts`: The **Rule Engine** that processes incoming emails against rules.
    *   `stats.ts`: Analytics aggregation.
*   **`src/server/services/notification`**:
    *   `generator.ts`: The Centralized Content Factory for "Agentic Push".
*   **`src/server/approvals`**:
    *   `service.ts`: Manages the lifecycle of Tool Approval Requests.
*   **`src/server/utils/linking`**: Logic for generating magic links to connect Slack/Discord accounts to Amodel users.
*   **`src/server/db`**: Database schema (`schema.prisma`) and client.


---

## 3. Feature Lookup Guide (Where to Edit)

### 🤖 AI Agent & Chat
| Feature | Key File / Directory | Description |
|---|---|---|
| **Chat Logic** | `src/server/integrations/ai/assistant/chat.ts` | The main loop handling user messages and tool calls. |
| **Agent Tools** | `src/server/integrations/ai/tools/` | Definitions of what the AI *can* do (Search, Read, Modify). |
| **Tool Security** | `src/server/integrations/ai/tools/security.ts` | Permissions check (Safe vs Caution mode). |
| **Unified Executor** | `src/server/agent/executor.ts` | Shared agent logic for Surfaces (Slack/Discord). |
| **Surfaces (Slack/Discord)** | `surfaces/src` | The Node.js Sidecar app handling incoming messages. |
| **Account Linking** | `src/server/utils/linking` | Magic link token generation. |
| **Approval System** | `src/server/approvals/service.ts` | Managing human-in-the-loop approvals for sensitive tools. |

### 📧 Email Features
| Feature | Key File / Directory | Description |
|---|---|---|
| **Search Logic** | `src/server/integrations/ai/tools/query.ts` | The unified search tool. |
| **Gmail Sync** | `src/server/integrations/google/history.ts` | Handling real-time updates from Gmail. |
| **Drafting** | `src/server/integrations/ai/tools/create.ts` | The tool AI uses to write emails. |
| **Sending** | `src/server/integrations/google/mail.ts` | Actual transport logic (Nodemailer/API). |

### ⚡ Rules & Automation
| Feature | Key File / Directory | Description |
|---|---|---|
| **Rule Engine** | `src/server/services/unsubscriber/engine.ts` | The "loop" that checks emails against active rules. |
| **Rule Creation** | `src/server/integrations/ai/rule/prompt-to-rules.ts` | AI converting "Archive receipts" -> JSON Rule. |
| **Rule Model** | `prisma/schema.prisma` (Look for `model Rule`) | The database structure for rules. |

### 🔐 Auth & Users
| Feature | Key File / Directory | Description |
|---|---|---|
| **OAuth** | `src/server/auth/` | Setup for Google/Microsoft login providers. |
| **User Data** | `src/server/db/client.ts` | User retrieval and context. |

---

## 4. How to Extend...

### **How to add a new AI Tool**
1.  Create a file in `src/server/integrations/ai/tools/` (e.g., `calendar-invite.ts`).
2.  Define the tool using Zod schema.
3.  Implement the `execute` function.
4.  Register it in `src/server/integrations/ai/tools/index.ts`.
5.  Add it to the `agentSystemPrompt` in `chat.ts`.

### **How to add a new Provider (e.g., Yahoo)**
1.  Create `src/server/integrations/yahoo/`.
2.  Implement the `EmailProvider` interface defined in `src/server/integrations/ai/tools/providers/email.ts`.
3.  Add the branching logic in `createEmailProvider` factory function.

### **How to add a new Rule Action**
1.  Update `ActionType` enum in `prisma/schema.prisma`.
2.  Run `bunx prisma generate`.
3.  Update the **Rule Engine** in `src/server/integrations/ai/choose-rule/run-rules.ts` (Real Engine) or `engine.ts` (Legacy).
4.  Update the **AI Tool** (`modify.ts` or `create.ts`) if the agent needs to perform it manually.

---

## 5. Key Concepts & Vocabulary

*   **ParsedMessage**: Our internal uniform representation of an email, regardless of whether it came from Gmail or Outlook.
*   **Thread**: A conversation of messages. We respect threading heavily.
*   **Rule**: A persistent automation (Condition -> Action).
*   **Tool**: An ephemeral capability the AI can use during a chat session.
*   **Integration**: Code that speaks a 3rd party API language.

