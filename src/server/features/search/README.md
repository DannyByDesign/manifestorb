# Search (`src/server/features/search`)

Search and indexing for assistant retrieval.

## Layout

- `unified/`: unified search interface used by the assistant runtime/tools
- `index/`: ingestion pipelines and index maintenance

The AI tool surfaces for search live under:
- Internal/unified search (email/calendar/rules/memory): `src/server/features/ai/tools/runtime/capabilities/search.ts`
- Web search + web fetch: `src/server/features/ai/tools/runtime/capabilities/web.ts`
