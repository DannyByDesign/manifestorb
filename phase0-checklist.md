# Phase 0: Infrastructure + Mobile-First Setup — Atomic Checklist

> Each checkbox is a **single, one-dimensional problem**. Solve them in order; combined, they complete Phase 0.

---

## 0.1 — Simplex Noise Library (`src/shaders/lib/noise.glsl`)

### 0.1.1 Create file structure
- [x] Create directory `src/shaders/lib/` if not exists
- [x] Create empty file `noise.glsl`

### 0.1.2 Implement permutation table
- [x] Define `mod289()` helper (prevents overflow in hash)
- [x] Define `permute()` function using mod289

### 0.1.3 Implement 3D simplex noise core
- [x] Define `taylorInvSqrt()` helper
- [x] Define gradient selection function
- [x] Implement `snoise(vec3)` — returns float in [-1, 1]

### 0.1.4 Add convenience wrappers
- [x] `snoise01(vec3)` — remaps [-1,1] → [0,1]
- [x] `fbm3(vec3, octaves)` — fractal Brownian motion
- [x] `curlNoise(vec3)` — curl of noise field for particle advection

---

## 0.2 — Common Shader Utilities (`src/shaders/lib/common.glsl`)

### 0.2.1 Create file
- [x] Create empty file `common.glsl`

### 0.2.2 Define shared uniform declarations
- [x] `uniform float uTime;`
- [x] `uniform vec2 uResolution;`
- [x] `uniform vec2 uPointer;`
- [x] `uniform vec2 uPointerVel;`
- [x] `uniform float uCursorEnergy;`

### 0.2.3 Define audio uniforms
- [x] `uniform float uAudioLevel;`
- [x] `uniform float uBass;`
- [x] `uniform float uMid;`
- [x] `uniform float uTreble;`

### 0.2.4 Add math utilities
- [x] `PI` constant
- [x] `TWO_PI` constant
- [x] `saturate(x)` — clamp(x, 0.0, 1.0)
- [x] `remap(value, inMin, inMax, outMin, outMax)`
- [x] `fresnel()` helper
- [x] `hsl2rgb()` color utility

---

## 0.3 — Shader Import Configuration

### 0.3.1 Determine import method
- [x] Check if Next.js supports raw imports for `.glsl` natively
- [x] Configure Turbopack with `raw-loader` rules
- [x] Configure webpack fallback with `asset/source`

### 0.3.2 Configure TypeScript declarations
- [x] Create `src/shaders/glsl.d.ts` with module declarations

### 0.3.3 Verify import works
- [x] Test import of `noise.glsl` in OrbCanvas component
- [x] Confirm string is returned at runtime (console.log test)
- [x] Production build succeeds

---

## 0.4 — Fullscreen Quad Vertex Shader (`src/shaders/sim/passthrough.vert`)

### 0.4.1 Create file
- [x] Create file `src/shaders/sim/passthrough.vert`

### 0.4.2 Implement passthrough logic
- [x] Use `gl_VertexID` for fullscreen triangle technique
- [x] Compute `vUv` from position
- [x] Set `gl_Position` to cover clip space [-1, 1]

---

## 0.5 — CSS Gradient Background (`src/app/globals.css`)

### 0.5.1 Define color palette
- [x] Exact hex for gradient top: `#fef3e8` (creamy peach)
- [x] Exact hex for gradient bottom: `#f8d5ce` (soft pink)

### 0.5.2 Update body styles
- [x] Add `background: linear-gradient(to bottom, <top>, <bottom>)`
- [x] Add `min-height: 100vh` to ensure gradient fills viewport
- [x] Dark mode variant with warm dark tones

### 0.5.3 Ensure canvas transparency
- [x] R3F Canvas has `alpha: true` (confirmed in OrbCanvas)
- [x] No opaque overlays hide gradient

---

## 0.6 — Capability Detection (`src/lib/capabilities.ts`)

### 0.6.1 Create file
- [x] Create file `src/lib/capabilities.ts`

### 0.6.2 Detect WebGL2 support
- [x] Create temp canvas
- [x] Attempt `canvas.getContext('webgl2')`
- [x] Return boolean `hasWebGL2`

### 0.6.3 Detect float render target support
- [x] Check for `EXT_color_buffer_float` extension (WebGL2)
- [x] Return boolean `hasFloatRT`

### 0.6.4 Detect linear filtering on float textures
- [x] Check for `OES_texture_float_linear` extension
- [x] Return boolean `hasFloatLinear`

### 0.6.5 Compute `useFluidSim` flag
- [x] `useFluidSim = hasWebGL2 && hasFloatRT && hasFloatLinear`

### 0.6.6 Define quality tier type
- [x] Create interface `QualityTier`

### 0.6.7 Detect device tier
- [x] Use heuristics: `navigator.maxTouchPoints > 0` → mobile
- [x] Check `navigator.userAgent` for iOS/Android
- [x] Screen width fallback

### 0.6.8 Export quality presets
- [x] Mobile preset: `{ simRes: 256, particleCount: 50000, dprClamp: 1.5, useFluidSim }`
- [x] Desktop preset: `{ simRes: 512, particleCount: 150000, dprClamp: 2, useFluidSim }`
- [x] Export function `getQualityTier(): QualityTier`

### 0.6.9 Export raw capabilities
- [x] Export object `{ hasWebGL2, hasFloatRT, hasFloatLinear, isMobile }`
- [x] Export `logCapabilities()` debug function

---

## 0.7 — Quality State Store (`src/lib/qualityStore.ts`)

### 0.7.1 Create file
- [x] Create file `src/lib/qualityStore.ts`

### 0.7.2 Define Zustand store
- [x] Import `create` from zustand
- [x] Define store with `tier: QualityTier` state
- [x] Add action `initialize()` that calls `getQualityTier()` and sets state

### 0.7.3 Create React hooks
- [x] Export `useQuality()` hook that returns current tier
- [x] Export `useQualityValue(key)` selector for individual values
- [x] Export `useFluidSimEnabled()`, `useParticleCount()`, `useSimResolution()`, `useDPRClamp()`

### 0.7.4 Add initialization point
- [x] Call `initialize()` in OrbCanvas on mount
- [x] Guard with `typeof window` for SSR safety
- [x] Log capabilities in development mode

---

## Verification Checklist

- [x] Production build succeeds (`bun run build`)
- [x] No TypeScript errors
- [x] Shader import returns string containing `snoise`
- [ ] Page background shows gradient (visible through transparent canvas) — *verify in browser*
- [ ] `console.log(capabilities)` on desktop shows `useFluidSim: true` — *verify in browser*
- [ ] `console.log(capabilities)` on iOS Safari shows correct fallback — *verify on device*

---

## Dependency Graph

```
0.1 noise.glsl ─────────────────────────────────┐
0.2 common.glsl ────────────────────────────────┼──→ 0.3 shader imports ✅
0.4 passthrough.vert ───────────────────────────┘
0.5 globals.css ─────────────────────────────────────→ (independent) ✅
0.6 capabilities.ts ─────────────────────────────────→ 0.7 qualityStore.ts ✅
```

---

## Summary

**Phase 0 Implementation: COMPLETE** ✅

All 7 sub-components implemented:
1. `noise.glsl` — 3D simplex + fbm + curl noise
2. `common.glsl` — Math utilities + uniform docs
3. Shader imports — Turbopack + webpack configured
4. `passthrough.vert` — Fullscreen triangle
5. `globals.css` — Gradient background
6. `capabilities.ts` — WebGL detection + quality tiers
7. `qualityStore.ts` — Zustand store with selectors

**Remaining**: Browser verification of runtime behavior.
