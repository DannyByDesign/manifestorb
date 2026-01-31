# AI Utilities (`src/server/utils/ai`)

This directory contains the low-level machinery for interacting with LLM providers (OpenAI, Anthropic, Fireworks).

## Core Logic
-   **`index.ts`**: Main entry point for generating text/objects.
-   **`types`**: Type definitions for `EmailAccountWithAI`.

## Provider Logic (`llms/`)
-   **`model.ts`**: The "Model Registry". Maps abstract names ("fast", "smart") to specific provider IDs (e.g., "claude-3-haiku", "gpt-4o").
-   **`openai.ts`**: OpenAI-specific adapter.
-   **`anthropic.ts`**: Anthropic-specific adapter.

## Feature-Specific Engines
-   **`choose-rule/`**: Logic for matching emails to user rules.
-   **`report/`**: Logic for summarizing email stats.
-   **`cold-email/`**: Logic for sales/marketing detection.
-   **`filebot/`**: Logic for Q&A over files.
