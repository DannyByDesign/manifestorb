# Issue: Web Search Routing Tuning

## Context

The runtime turn compiler now routes explicit web-search requests (and some time-sensitive "latest/current" queries) into a deterministic single-tool `web.search` call.

## Follow-ups

- Make the heuristic configurable (env or user config) to disable/relax "time-sensitive" auto-web-search routing.
- Improve query extraction for indirect prompts (e.g. strip leading "what's the latest on" while preserving entity/topic).
- Consider whether `web.fetch` should ever be eligible for deterministic single-tool routing (likely only when the user provides a URL).

