---
trigger: always_on
---

# Coding Agent Rules (Staff-Engineer Level)

Build this project as a production-grade, GPU-heavy interactive UI: prioritize correctness, performance, and debuggability over cleverness. Keep modules small and composable, put all WebGL/R3F code behind `"use client"` boundaries, avoid SSR-only globals (`window`, `document`, `AudioContext`) outside client components, and treat mobile Safari as a first-class target (capability checks, graceful fallbacks, and user-gesture audio start). Always add a minimal reproducible test page for risky changes (shader import, FBO ping-pong, audio analyser), and keep performance budgets explicit (particle counts, sim resolution, DPR clamp). Prefer deterministic behavior (seeded randomness) where possible so visual regressions are easier to spot. Document every non-obvious shader uniform and every capability decision in-code with comments.

## Golden Rules
- No workarounds without explaining the root cause and tradeoffs.
- Never ship a feature without a fallback path for mobile.
- Keep shader code readable: shared `common.glsl`, consistent naming (`uTime`, `uPointer`, etc), and avoid “magic numbers” without comments.
- Any new dependency must be justified and linked in this file.
- Add a “Debug Mode” toggle (Leva) for: FPS, tier info, sim resolution, particle count, bloom intensity.

---

## Dependency Documentation (check these FIRST if we run into issues)

If we are running into issues, check the documentation here first:

### Core stack
- Bun (runtime + package manager): https://bun.com/docs/installation
- Bun + Next.js guide: https://bun.com/docs/guides/ecosystem/nextjs
- Next.js Docs (App Router): https://nextjs.org/docs/app
- Next.js “Getting Started / Installation”: https://nextjs.org/docs/app/getting-started/installation
- React Docs: https://react.dev/
- TypeScript Handbook: https://www.typescriptlang.org/docs/handbook/intro.html

### Deployment
- Vercel Docs (Deployments): https://vercel.com/docs/deployments
- Next.js on Vercel: https://vercel.com/docs/frameworks/full-stack/nextjs
- Vercel CLI: https://vercel.com/docs/cli

### WebGL / 3D / Postprocessing
- three.js Docs: https://threejs.org/docs/
- three.js Manual: https://threejs.org/manual/
- React Three Fiber (R3F) Docs: https://r3f.docs.pmnd.rs/
- R3F events (pointer interaction): https://r3f.docs.pmnd.rs/api/events
- React Three Drei (helpers): https://drei.docs.pmnd.rs/
- React Postprocessing Docs: https://react-postprocessing.docs.pmnd.rs/
- pmndrs/postprocessing Docs: https://pmndrs.github.io/postprocessing/public/docs/
- pmndrs/postprocessing Repo (reference): https://github.com/pmndrs/postprocessing
- react-postprocessing Repo (reference): https://github.com/pmndrs/react-postprocessing

### State / Controls / Animation
- Zustand Docs: https://zustand.docs.pmnd.rs/
- Leva Docs: https://pmndrs.github.io/leva/
- GSAP Docs: https://gsap.com/docs/v3/

### Styling
- Tailwind CSS Docs: https://tailwindcss.com/docs

### Browser APIs we rely on
- MDN Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- MDN AudioContext: https://developer.mozilla.org/en-US/docs/Web/API/AudioContext
- MDN WebGL2RenderingContext: https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext
- MDN WebGL API overview: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API
- MDN Using WebGL extensions (capability detection): https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Using_Extensions
