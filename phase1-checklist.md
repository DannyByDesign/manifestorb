# Phase 1: Static Orb Rendering — Atomic Checklist

> **Goal**: Render a beautiful glassmorphic orb with fresnel rim and environment tinting.
> 
> **Note**: Phase 1 uses mesh geometry as a rapid prototype. Phase 1.5 (in this same checklist) refactors to SDF for shape-morphing support — this is **critical** for the grand vision.

Each checkbox is a **single, one-dimensional problem**. Solve them in order.

---

## 1.1 — Orb Vertex Shader (`src/shaders/orb.vert`)

### 1.1.1 Set up shader header
- [x] Three.js auto-provides version pragma via R3F
- [x] Precision handled by Three.js

### 1.1.2 Declare attributes (inputs)
- [x] `position` — vertex position (auto-provided)
- [x] `normal` — vertex normal (auto-provided)
- [x] `uv` — texture coordinates (auto-provided)

### 1.1.3 Declare uniforms
- [x] `modelMatrix` (auto-provided)
- [x] `viewMatrix` (auto-provided)
- [x] `projectionMatrix` (auto-provided)
- [x] `normalMatrix` (auto-provided)
- [x] `uniform float uTime;`

### 1.1.4 Declare varyings (outputs to fragment)
- [x] `out vec3 vNormal;` — world-space normal
- [x] `out vec3 vViewDir;` — view direction for fresnel
- [x] `out vec2 vUv;` — UV coordinates
- [x] `out vec3 vPosition;` — world position

### 1.1.5 Implement main()
- [x] Compute world position: `vec4 worldPos = modelMatrix * vec4(position, 1.0);`
- [x] Compute view direction: `vViewDir = normalize(cameraPosition - worldPos.xyz);`
- [x] Transform normal to world space: `vNormal = normalize(normalMatrix * normal);`
- [x] Pass UV: `vUv = uv;`
- [x] Pass world position: `vPosition = worldPos.xyz;`
- [x] Set gl_Position: `gl_Position = projectionMatrix * viewMatrix * worldPos;`

---

## 1.2 — Orb Fragment Shader (`src/shaders/orb.frag`)

### 1.2.1 Set up shader header
- [x] Three.js auto-provides version pragma
- [x] Precision handled by Three.js
- [x] Output via `gl_FragColor` (Three.js injects)

### 1.2.2 Declare varyings (inputs from vertex)
- [x] `in vec3 vNormal;`
- [x] `in vec3 vViewDir;`
- [x] `in vec2 vUv;`
- [x] `in vec3 vPosition;`

### 1.2.3 Declare uniforms
- [x] `uniform float uTime;`
- [x] `uniform vec2 uResolution;`
- [x] `uniform vec2 uPointer;`
- [x] `uniform vec2 uPointerVel;`
- [x] `uniform float uCursorEnergy;`

### 1.2.4 Define color constants
- [x] Base pink: `vec3(0.96, 0.78, 0.78)` — HSL(340, 70%, 85%)
- [x] Rim color: `vec3(1.0, 0.95, 0.95)` — near-white pink
- [x] Core color: `vec3(0.98, 0.82, 0.80)` — warmer/paler pink

### 1.2.5 Implement fresnel function
- [x] Define `float fresnel(float cosTheta, float power)`
- [x] Return `pow(1.0 - cosTheta, power);`

### 1.2.6 Implement main() — base color
- [x] Normalize vNormal: `vec3 N = normalize(vNormal);`
- [x] Normalize vViewDir: `vec3 V = normalize(vViewDir);`
- [x] Compute NdotV: `float NdotV = max(dot(N, V), 0.0);`

### 1.2.7 Implement main() — fresnel rim
- [x] Compute fresnel term: `float rim = fresnel(NdotV, 3.0);`
- [x] Mix base with rim color: `vec3 color = mix(baseColor, rimColor, rim);`

### 1.2.8 Implement main() — core gradient
- [x] Compute depth factor from view angle: `float coreFactor = pow(NdotV, 2.0);`
- [x] Blend core into center: `color = mix(color, coreColor, coreFactor * 0.3);`

### 1.2.9 Implement main() — output
- [x] Added subtle time-based shimmer
- [x] Set alpha to 1.0 for opaque orb
- [x] Output: `gl_FragColor = vec4(color, 1.0);`

---

## 1.3 — Orb Component (`src/components/Orb.tsx`)

### 1.3.1 Create file
- [x] Create new file `src/components/Orb.tsx`
- [x] Add `"use client";` directive

### 1.3.2 Import dependencies
- [x] Import `useRef` from React
- [x] Import `useFrame, useThree, extend` from `@react-three/fiber`
- [x] Import `shaderMaterial` from `@react-three/drei`
- [x] Import `THREE` from `three`

### 1.3.3 Import shaders
- [x] Import `orbVertexShader from "@/shaders/orb.vert"`
- [x] Import `orbFragmentShader from "@/shaders/orb.frag"`

### 1.3.4 Create shader material class
- [x] Use `shaderMaterial()` to create `OrbMaterialImpl`
- [x] Define uniforms: `uTime`, `uResolution`, `uPointer`, `uPointerVel`, `uCursorEnergy`
- [x] Pass vertex and fragment shader strings

### 1.3.5 Extend Three.js with material
- [x] Call `extend({ OrbMaterial: OrbMaterialImpl })`
- [x] Define TypeScript type for uniforms

### 1.3.6 Create Orb component
- [x] Define `export function Orb()` component
- [x] Create ref for material with proper type

### 1.3.7 Implement useFrame for uniforms
- [x] Update `uTime` each frame
- [x] Update `uResolution`

### 1.3.8 Render mesh
- [x] Return `<mesh>` element
- [x] Add `<sphereGeometry args={[1, 128, 128]} />` — high subdivision
- [x] Add material via `<primitive>` element (type-safe pattern)

---

## 1.4 — Integrate into OrbCanvas

### 1.4.1 Import Orb component
- [x] Add `import { Orb } from "@/components/Orb";` to OrbCanvas.tsx

### 1.4.2 Replace placeholder mesh
- [x] Remove the existing `<mesh>` with sphereGeometry + meshStandardMaterial
- [x] Add `<Orb />` component in its place

### 1.4.3 Remove test shader import
- [x] Remove the `import noiseShader` line
- [x] Remove the console.log test in useEffect

---

## 1.5 — Tune Bloom Parameters

### 1.5.1 Adjust Bloom intensity
- [x] Set to `intensity={1.2}` 

### 1.5.2 Adjust luminance threshold
- [x] Set to `luminanceThreshold={0.15}`

### 1.5.3 Adjust luminance smoothing
- [x] Set to `luminanceSmoothing={0.9}`

### 1.5.4 Add bloom radius (optional)
- [ ] Test additional radius if needed after visual verification

---

## 1.6 — SDF Architecture Refactor (Phase 1.5)

> [!IMPORTANT]
> This section implements the SDF rendering pipeline required for future shape morphing.
> The mesh-based orb (1.1-1.5) was a prototype; this is the production architecture.

### 1.6.1 Create SDF Primitives Library (`src/shaders/lib/sdf.glsl`)

- [ ] Create file `src/shaders/lib/sdf.glsl`
- [ ] Implement `sdSphere(vec3 p, float r)`:
  ```glsl
  float sdSphere(vec3 p, float r) {
    return length(p) - r;
  }
  ```
- [ ] Implement `sdRoundedBox(vec3 p, vec3 b, float r)`:
  ```glsl
  float sdRoundedBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }
  ```
- [ ] Implement `sdCapsule(vec3 p, vec3 a, vec3 b, float r)` — for pill shapes
- [ ] Implement `opSmoothUnion(float d1, float d2, float k)` — organic blending:
  ```glsl
  float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
  }
  ```
- [ ] Implement `opMorph(float d1, float d2, float t)` — linear interpolation
- [ ] Add header comment documenting each function's purpose

### 1.6.2 Create Raymarched Orb Shader (`src/shaders/orb-sdf.frag`)

#### Setup
- [ ] Create file `src/shaders/orb-sdf.frag`
- [ ] Declare uniforms:
  - `uniform float uTime;`
  - `uniform vec2 uResolution;`
  - `uniform vec3 uCameraPos;`
  - `uniform mat4 uCameraMatrix;` (inverse view matrix)
  
#### Shape morphing uniforms
- [ ] `uniform int uShapeType;` — 0=sphere, 1=roundedBox, 2=capsule
- [ ] `uniform float uMorphProgress;` — 0..1 for shape transitions
- [ ] `uniform vec3 uShapeDimensions;` — target shape size (x=width, y=height, z=depth)
- [ ] `uniform float uCornerRadius;` — for rounded rectangles
- [ ] `uniform float uSurfaceNoise;` — displacement amplitude

#### Color uniforms (from CSS)
- [ ] `uniform vec3 uBaseColor;`
- [ ] `uniform vec3 uCoolColor;`
- [ ] `uniform vec3 uWarmColor;`

#### Implement SDF scene function
- [ ] Create `float sceneSDF(vec3 p)`:
  - Compute sphere SDF
  - Compute rounded box SDF (using uShapeDimensions, uCornerRadius)
  - Mix based on uMorphProgress
  - Add noise perturbation if uSurfaceNoise > 0

#### Implement raymarching
- [ ] Create `float raymarch(vec3 ro, vec3 rd)`:
  - Loop with max steps (use `#define MAX_STEPS 64`)
  - Early exit when distance < epsilon (0.001)
  - Early exit when distance > max distance (10.0)
  - Return total distance traveled

#### Implement normal calculation
- [ ] Create `vec3 calcNormal(vec3 p)`:
  - Use central differences on SDF
  - `vec3 e = vec3(0.001, 0.0, 0.0);`
  - Sample SDF at 6 points, compute gradient

#### Port glassmorphic shading
- [ ] Copy fresnel function from `orb.frag`
- [ ] Implement environment gradient mapping using SDF normals
- [ ] Implement holographic iridescence
- [ ] Implement specular highlights
- [ ] Implement rim lighting

#### Final output
- [ ] Combine all shading components
- [ ] Output `gl_FragColor` with proper alpha

### 1.6.3 Create SDFOrb Component (`src/components/SDFOrb.tsx`)

- [ ] Create file `src/components/SDFOrb.tsx`
- [ ] Add `"use client";` directive
- [ ] Import dependencies:
  - `useRef, useMemo` from React
  - `useFrame, useThree` from `@react-three/fiber`
  - `shaderMaterial` from `@react-three/drei`
  - GSAP for morph animations
- [ ] Import shaders:
  - `passthrough.vert` for fullscreen quad
  - `orb-sdf.frag` for raymarching

#### Create shader material
- [ ] Use `shaderMaterial()` to create `SDFOrbMaterialImpl`
- [ ] Define all uniforms with default values
- [ ] `extend({ SDFOrbMaterial: SDFOrbMaterialImpl })`

#### Implement fullscreen quad rendering
- [ ] Create geometry: `new THREE.PlaneGeometry(2, 2)` (clip-space quad)
- [ ] Position at origin, no transform needed

#### Implement camera uniform updates
- [ ] In `useFrame`, update:
  - `uTime` from clock
  - `uCameraPos` from camera.position
  - `uCameraMatrix` from camera.matrixWorld
  - `uResolution` from viewport size

#### Implement CSS color sync
- [ ] Copy `getCssColor()` helper from `Orb.tsx`
- [ ] Update color uniforms each frame

#### Add Leva debug controls
- [ ] `uShapeType` — dropdown: sphere, roundedBox, capsule
- [ ] `uMorphProgress` — slider 0..1
- [ ] `uShapeDimensions` — vec3 editor
- [ ] `uCornerRadius` — slider 0..1
- [ ] `uSurfaceNoise` — slider 0..0.2

### 1.6.4 Create Shape State Store (`src/lib/shapeStore.ts`)

- [ ] Create file `src/lib/shapeStore.ts`
- [ ] Define `ShapeType` union: `'orb' | 'calendar' | 'settings' | 'chat'`
- [ ] Define `ShapeConfig` interface:
  ```ts
  interface ShapeConfig {
    type: number;           // SDF type index
    dimensions: [number, number, number];
    cornerRadius: number;
  }
  ```
- [ ] Define shape presets:
  - `orb`: sphere, radius 1
  - `calendar`: rounded box, 2.5 x 2 x 0.1, corner 0.15
  - `settings`: rounded box, 1.8 x 2.2 x 0.1, corner 0.2
  - `chat`: capsule-based bubble
- [ ] Create Zustand store:
  - `currentShape: ShapeType`
  - `morphProgress: number`
  - `config: ShapeConfig`
  - `transitioning: boolean`
- [ ] Implement `morphTo(shape: ShapeType)`:
  - Set `transitioning: true`
  - Use GSAP to animate `morphProgress` 0→1
  - Update `config` to target shape preset
  - Set `transitioning: false` on complete
- [ ] Export selector hooks:
  - `useCurrentShape()`
  - `useMorphProgress()`
  - `useShapeConfig()`

### 1.6.5 Integrate SDFOrb into Scene

- [ ] Import `SDFOrb` in `Scene.tsx`
- [ ] Replace `<Orb />` with `<SDFOrb />`
- [ ] Verify rendering works
- [ ] Remove old `<Orb />` import (keep file for reference)

### 1.6.6 Mobile Optimization

- [ ] Add quality-tier aware MAX_STEPS:
  - Desktop: 64 steps
  - Mobile: 32 steps
- [ ] Test on iOS Safari (real device or BrowserStack)
- [ ] Profile performance, ensure 30+ fps on mobile
- [ ] Add fallback for very low-end devices if needed

### 1.6.7 Visual Parity Verification

- [ ] Compare SDF orb to mesh orb side-by-side
- [ ] Tune colors/fresnel to match
- [ ] Verify bloom still works correctly
- [ ] Screenshot comparison for regression testing

---

## Verification Checklist (Mesh Prototype — 1.1-1.5)

After mesh prototype tasks complete, manually verify in browser (`bun dev`):

- [ ] Orb renders centered in viewport
- [ ] Orb has glassmorphic appearance with environment tinting
- [ ] Fresnel rim visible (lighter edge when viewed at angle)
- [ ] Holographic iridescence on grazing angles
- [ ] Bloom creates soft glow around orb
- [ ] No console errors
- [x] No TypeScript errors in build ✅

---

## Verification Checklist (SDF Refactor — 1.6)

After SDF refactor tasks complete, manually verify:

### Visual Parity
- [ ] SDF orb looks identical to mesh orb (color, shading, rim)
- [ ] Bloom still creates soft glow
- [ ] No visual artifacts or banding

### Shape Morphing
- [ ] Can morph sphere ↔ rounded box via Leva controls
- [ ] Morph animation is smooth (no popping)
- [ ] Glassmorphic shading works on ALL shapes
- [ ] Corner radius adjusts correctly on rounded box

### Performance
- [ ] 60fps on desktop (Chrome DevTools Performance)
- [ ] 30+ fps on mobile Safari
- [ ] No "Long Task" warnings

### Code Quality
- [ ] No TypeScript errors
- [ ] No console errors
- [ ] ShapeStore works correctly (test morphTo())

---

## Summary

### Mesh Prototype (1.1-1.5): IN PROGRESS

Files created/modified:
- `src/shaders/orb.vert` — vertex shader with view direction
- `src/shaders/orb.frag` — fragment shader with fresnel + environment tinting + iridescence
- `src/components/Orb.tsx` — React component with shaderMaterial, CSS color sync
- `src/components/Scene.tsx` — integrated Orb with quality-tier DPR

**Status**: Code complete, awaiting visual verification.

### SDF Refactor (1.6): NOT STARTED

Files to create:
- `src/shaders/lib/sdf.glsl` — SDF primitives library
- `src/shaders/orb-sdf.frag` — raymarched glassmorphic shader
- `src/components/SDFOrb.tsx` — fullscreen quad SDF renderer
- `src/lib/shapeStore.ts` — shape morphing state management

**Status**: Blocked on mesh prototype verification.

---

## Dependency Graph

```
1.1-1.5 Mesh Prototype ──────────────────────────────────────────┐
   │                                                              │
   ▼                                                              │
Verify mesh orb visuals ──────────────────────────────────────────┤
   │                                                              │
   ▼                                                              │
1.6.1 sdf.glsl ─────────────────┐                                 │
                                │                                 │
1.6.2 orb-sdf.frag ◄────────────┤                                 │
         │                      │                                 │
         ▼                      │                                 │
1.6.3 SDFOrb.tsx ◄──────────────┘                                 │
         │                                                        │
         ├──────────────────────────────────────────────────────► Compare
         │                                                        │
1.6.4 shapeStore.ts                                               │
         │                                                        │
         ▼                                                        │
1.6.5 Integrate into Scene ◄──────────────────────────────────────┘
         │
         ▼
1.6.6 Mobile optimization
         │
         ▼
1.6.7 Visual parity verification
```
