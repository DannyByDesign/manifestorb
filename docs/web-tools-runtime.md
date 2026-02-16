# Runtime Web Tools (`web.search`, `web.fetch`)

`amodel` now includes two runtime web research tools:

- `web.search`: provider-backed internet search (Brave default, Perplexity optional)
- `web.fetch`: URL fetch + extraction with SSRF protections and redirect re-validation

## Provider setup

Set at least one search provider key:

- `BRAVE_API_KEY` for Brave Search (`web.search` default provider)
- `PERPLEXITY_API_KEY` or `OPENROUTER_API_KEY` for Perplexity provider

Optional fetch fallback:

- `FIRECRAWL_API_KEY` to enable Firecrawl extraction fallback for difficult pages

## Runtime tuning (optional)

All runtime tuning keys are optional and default to safe bounded values:

- `TOOL_WEB_SEARCH_*`
- `TOOL_WEB_FETCH_*`

See `/Users/dannywang/Projects/amodel/.env.example` for a full list.

## Security model

`web.fetch` is SSRF-hardened:

- blocks localhost, `.local`, `.internal`, and known metadata hosts
- blocks private/loopback/link-local IPv4 and IPv6 ranges
- resolves DNS and blocks if any resolved address is private/internal
- uses DNS-pinned request dispatchers to reduce DNS rebinding risk
- revalidates every redirect hop against the same SSRF rules

Blocked destinations return structured tool errors (`error: "ssrf_blocked"`).
