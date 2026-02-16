# Authentication (WorkOS AuthKit)

All auth and WorkOS usage is centralized here.

## Layout

- **`index.ts`** – Public API. Re-exports session helpers and WorkOS entry points (`getSignInUrl`, `handleAuth`, `signOut`, `authkitMiddleware`). **This is the only place that imports from `@workos-inc/authkit-nextjs`.**
- **`session.ts`** – Session logic: `withAuth()` → local user lookup/creation, `saveTokens()`, post-sign-up Resend contact sync.
- **`cleanup-invalid-tokens.ts`** – Invalid token cleanup (e.g. after disconnect).
- **`session.test.ts`** – Tests for `saveTokens`.

## Usage

- **Get current user:** `import { auth } from "@/server/auth"; const session = await auth();`
- **Routes:** App routes under `src/app/login`, `src/app/callback`, `src/app/logout` call `getSignInUrl`, `handleAuth`, `signOut` from `@/server/auth`.
- **Proxy:** `src/proxy.ts` uses `authkitMiddleware` from `@/server/auth`.

Do not import from `@workos-inc/authkit-nextjs` outside this directory; use `@/server/auth` instead. The only exception is `src/app/layout.tsx`, which imports `AuthKitProvider` from the package for the client-side provider.
