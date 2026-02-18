# `src/`

This is the main Next.js application (App Router) plus all backend runtime code.

Start here:
- high-level map: `src/ARCHITECTURE_MAP.md`
- backend layout: `src/server/README.md`

## Layout

```
src/
├── app/          Next.js routes and API endpoints (public entrypoints)
├── server/       Backend runtime: domain modules, integrations, infrastructure
├── components/   React UI components (including 3D experience)
├── lib/          Client/shared UI helpers and state
├── shaders/      GLSL shader assets
├── enterprise/   Premium/billing-related UI and helpers
├── env.ts        Runtime environment schema (authoritative)
└── proxy.ts      Edge/auth proxy wiring (middleware-style)
```

## Entry Points

- Web chat: `src/app/api/chat/route.ts`
- Surfaces inbound bridge: `src/app/api/surfaces/inbound/route.ts`
- Gmail/Calendar webhooks: `src/app/api/google/*`

The unified assistant runtime lives under `src/server/features/ai/`.

