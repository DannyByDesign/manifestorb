# Orb Glow

A small Next.js prototype for an interactive glowing orb scene built with React Three Fiber and custom GLSL shaders.

## Stack

- Next.js 16
- React 19
- Three.js
- React Three Fiber
- React Three Drei
- React Three Postprocessing
- Zustand
- Tailwind CSS 4

## What Is In This Repo

The current app is intentionally small:

- [src/app/page.tsx](/Users/dannywang/Desktop/Orb-glow/src/app/page.tsx) mounts one full-screen scene
- [src/components/experience/Scene.tsx](/Users/dannywang/Desktop/Orb-glow/src/components/experience/Scene.tsx) builds the lighting, orb layers, and bloom pass
- [src/components/experience/orbReference/shaders.ts](/Users/dannywang/Desktop/Orb-glow/src/components/experience/orbReference/shaders.ts) contains the particle and simulation shaders
- [src/lib/capabilities.ts](/Users/dannywang/Desktop/Orb-glow/src/lib/capabilities.ts) and [src/lib/stores/qualityStore.ts](/Users/dannywang/Desktop/Orb-glow/src/lib/stores/qualityStore.ts) handle capability detection and quality defaults

## Getting Started

Prerequisite:

- Bun 1.2.2 or newer

Install dependencies:

```bash
bun install
```

Run the dev server:

```bash
bun run dev
```

Build for production:

```bash
bun run build
```

Start the production server:

```bash
bun run start
```

Lint the project:

```bash
bun run lint
```

## Notes

- The app uses the Next.js App Router.
- The scene is client-rendered because the WebGL canvas, shaders, and capability detection depend on the browser.
- Shader source currently lives inline in TypeScript rather than in separate `.glsl` files.
- `dev` uses webpack by default; `dev:turbo` is available if you want to try Turbopack locally.
