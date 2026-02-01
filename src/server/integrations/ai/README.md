# AI Integration Module

This module houses the core logic for the AI Agent, including the tool definitions, rule engine connections, and model configuration.

## 1. The Polymorphic Toolset (`tools/`)
We use a standardized set of 5 "Polymorphic" tools to interact with all backend resources. This simplifies the Agent's decision-making process.

| Tool | Purpose | Key Resources |
| :--- | :--- | :--- |
| `query` | Search and list items | `email`, `calendar`, `automation`, `patterns`, `approval`, `drive`, `contacts` |
| `get` | Retrieve item details | `email`, `approval` |
| `create` | Create new items (Drafts) | `email`, `automation`, `knowledge`, `drive` (Filing), `notification` (Push), `contacts` |
| `modify` | Update item state | `email` (archive/label/track), `automation`, `approval` (decide) |
| `analyze` | Pure logic/extraction | `email` (clean/categorize), `calendar` (briefing), `patterns` |

### Key Files
- `tools/index.ts`: Tool registry and export.
- `tools/query.ts`: Implementation of the `query` tool.
- `tools/create.ts`: Implementation of the `create` tool.
- `tools/modify.ts`: Implementation of the `modify` tool.
- `tools/types.ts`: TypeScript definitions for Tool arguments and Resources.

## 2. The Third Brain (`tools/providers/automation.ts`)
The `AutomationProvider` acts as the bridge between the Agent and the user's defined rules.
- **Match Rules**: Exposes `matchRules(messageId)` to the Agent via `query({ resource: "patterns" })`.
- **Enforcement**: The System Prompt requires the Agent to check for rules before taking action on emails.

## 3. Providers (`tools/providers/`)
Tools delegate actual execution to these Providers to maintain clear boundaries.
- `automation.ts`: Rules, Knowledge, Unsubscriber, Reports.
- `email.ts`: Wraps the Service Layer Email Provider for Tool compatibility.

## 4. Assistant (`assistant/`)
- `chat.ts`: The main entry point for the Vercel AI SDK chat loop. Contains the **System Prompt**.
