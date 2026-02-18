# Conversations (`src/server/features/conversations`)

Persistence and retrieval for conversations and conversation messages across platforms.

## Key Files

- `service.ts`: `ConversationService` (create/get conversations, append messages, query history)

The AI runtime uses conversation history to build context; memory recording uses messages across *all* conversations for a user.

