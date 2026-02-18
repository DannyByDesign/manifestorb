# Knowledge (`src/server/features/knowledge`)

User and account-scoped knowledge base used for better drafting and personalization.

## Layout

- `ai/`: LLM helpers that extract or synthesize knowledge (persona, writing style, relevant knowledge extraction)

Knowledge embeddings and retrieval are shared with the memory subsystem under `src/server/features/memory/embeddings`.

