# AI Integration Layer (`src/server/integrations/ai`)

This directory houses the "Brain" of the application—the AI systems, prompt chains, and tool definitions.

## Subdirectories

### 1. `assistant/` (The Chatbot)
-   **`chat.ts`**: The main entry point for the standard "Chat Assistant". It manages the Vercel AI SDK `streamText` loop.
-   **Capabilities**: Unlike the Agent, this Assistant has **full access** to the Rules Engine (Create Rule, Knowledge Base).

### 2. `tools/` (The Agent Toolkit)
-   **`index.ts`**: Exports `createAgentTools` which bundles tools for the Executor.
-   **`providers/`**: Interface definitions for `email`, `calendar`, `automation`.
-   **Tools**:
    -   `query`: Search for emails/events.
    -   `get`: Retrieve full details by ID.
    -   `modify`: Archive, Trash, Label.
    -   `create`: Draft emails.
    -   `analyze`: Analyze content (Stub).

### 3. `choose-rule/` (The Classifier)
-   Logic for determining if an incoming email matches an existing user rule.
-   Used by the `Unsubscriber` service to process inbox rules.

### 4. `report/` (The Analyst)
-   Prompts and logic for generating the `Executive Summary`, `User Persona`, and `Behavior Analysis`.

### 5. `categorize-sender/`
-   Logic for clustering senders (e.g., "Newsletters", "Receipts").

### 6. `mcp/` (Model Context Protocol)
-   Experimental support for connecting to external MCP servers.

### 7. `reply/`
-   Generates AI suggested replies for emails.

## Key Files
-   **`actions.ts`**: Server Actions for UI interaction with AI features.
-   **`security.ts`**: Utilities for prompt injection defense.
