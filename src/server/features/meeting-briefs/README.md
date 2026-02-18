# Meeting Briefs (`src/server/features/meeting-briefs`)

Meeting briefing pipeline: fetch upcoming events, gather context, and generate a short briefing artifact.

## Key Files

- `fetch-upcoming-events.ts`: pulls candidate events to brief
- `gather-context.ts`: collects relevant context (attendees, prior emails, etc.)
- `process.ts`: orchestration entrypoint
- `ai/`: LLM helpers for generating the briefing content

