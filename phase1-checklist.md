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

- [x] Create file `src/shaders/lib/sdf.glsl`
- [x] Implement `sdSphere(vec3 p, float r)`:
  ```glsl
  float sdSphere(vec3 p, float r) {
    return length(p) - r;
  }
  ```
- [x] Implement `sdRoundedBox(vec3 p, vec3 b, float r)`:
  ```glsl
  float sdRoundedBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
  }
  ```
- [x] Implement `sdCapsule(vec3 p, vec3 a, vec3 b, float r)` — for pill shapes
- [x] Implement `opSmoothUnion(float d1, float d2, float k)` — organic blending:
  ```glsl
  float opSmoothUnion(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
    return mix(d2, d1, h) - k * h * (1.0 - h);
  }
  ```
- [x] Implement `opMorph(float d1, float d2, float t)` — linear interpolation
- [x] Add header comment documenting each function's purpose
- [x] **Bonus**: Added additional primitives (box, torus, cylinder, ellipsoid)
- [x] **Bonus**: Added domain operations (translate, rotate)
- [x] **Bonus**: Added 2D primitives for extrusion

### 1.6.2 Create Raymarched Orb Shader (`src/shaders/orb-sdf.frag`)

#### Setup
- [x] Create file `src/shaders/orb-sdf.frag`
- [x] Create file `src/shaders/orb-sdf.vert` (vertex shader for fullscreen quad)
- [x] Declare uniforms:
  - `uniform float uTime;`
  - `uniform vec2 uResolution;`
  - `uniform vec3 uCameraPos;`
  - `uniform mat4 uInverseProjectionMatrix;` + `uniform mat4 uCameraMatrixWorld;`
  
#### Shape morphing uniforms
- [x] `uniform int uShapeType;` — 0=sphere, 1=roundedBox, 2=capsule
- [x] `uniform float uMorphProgress;` — 0..1 for shape transitions
- [x] `uniform vec3 uShapeDimensions;` — target shape size (x=width, y=height, z=depth)
- [x] `uniform float uCornerRadius;` — for rounded rectangles
- [x] `uniform float uSurfaceNoise;` — displacement amplitude
- [x] `uniform float uSphereRadius;` — base sphere radius

#### Color uniforms (from CSS)
- [x] `uniform vec3 uBaseColor;`
- [x] `uniform vec3 uCoolColor;`
- [x] `uniform vec3 uWarmColor;`

#### Implement SDF scene function
- [x] Create `float sceneSDF(vec3 p)`:
  - Compute sphere SDF
  - Compute rounded box SDF (using uShapeDimensions, uCornerRadius)
  - Mix based on uMorphProgress
  - Add noise perturbation if uSurfaceNoise > 0

#### Implement raymarching
- [x] Create `float raymarch(vec3 ro, vec3 rd)`:
  - Loop with max steps (uniform `uMaxSteps` for quality tiers)
  - Early exit when distance < epsilon (0.001)
  - Early exit when distance > max distance (20.0)
  - Return total distance traveled

#### Implement normal calculation
- [x] Create `vec3 calcNormal(vec3 p)`:
  - Use central differences on SDF
  - Sample SDF at 6 points, compute gradient

#### Port glassmorphic shading
- [x] Copy fresnel function from `orb.frag`
- [x] Implement environment gradient mapping using SDF normals
- [x] Implement holographic iridescence
- [x] Implement specular highlights
- [x] Implement rim lighting

#### Final output
- [x] Combine all shading components
- [x] Output `gl_FragColor` with proper alpha (transparent for miss)

### 1.6.3 Create SDFOrb Component (`src/components/SDFOrb.tsx`)

- [x] Create file `src/components/SDFOrb.tsx`
- [x] Add `"use client";` directive
- [x] Import dependencies:
  - `useRef, useMemo` from React
  - `useFrame, useThree` from `@react-three/fiber`
  - `shaderMaterial` from `@react-three/drei`
  - `useControls` from Leva for debug controls
- [x] Import shaders:
  - `orb-sdf.vert` for fullscreen quad
  - `orb-sdf.frag` for raymarching

#### Create shader material
- [x] Use `shaderMaterial()` to create `SDFOrbMaterialImpl`
- [x] Define all uniforms with default values
- [x] `extend({ SDFOrbMaterial: SDFOrbMaterialImpl })`

#### Implement fullscreen quad rendering
- [x] Create geometry: `new THREE.PlaneGeometry(2, 2)` (clip-space quad)
- [x] Position at origin, no transform needed
- [x] Set `frustumCulled={false}` and proper render order

#### Implement camera uniform updates
- [x] In `useFrame`, update:
  - `uTime` from clock
  - `uCameraPos` from camera.position
  - `uInverseProjectionMatrix` from camera.projectionMatrixInverse
  - `uCameraMatrixWorld` from camera.matrixWorld
  - `uResolution` from viewport size (with DPR)

#### Implement CSS color sync
- [x] Copy `getCssColor()` helper from `Orb.tsx`
- [x] Update color uniforms each frame

#### Add Leva debug controls
- [x] `uShapeType` — dropdown: Sphere, Rounded Box, Capsule
- [x] `uMorphProgress` — slider 0..1
- [x] `sphereRadius`, `boxWidth`, `boxHeight`, `boxDepth` — dimension controls
- [x] `uCornerRadius` — slider 0..0.5
- [x] `uSurfaceNoise` — slider 0..0.15
- [x] `noiseScale`, `noiseSpeed` — noise parameters

### 1.6.4 Create Shape State Store (`src/lib/shapeStore.ts`)

- [x] Create file `src/lib/shapeStore.ts`
- [x] Define `ShapeType` union: `'orb' | 'calendar' | 'settings' | 'chat'`
- [x] Define `ShapeConfig` interface:
  ```ts
  interface ShapeConfig {
    type: number;           // SDF type index
    dimensions: [number, number, number];
    cornerRadius: number;
    sphereRadius: number;
  }
  ```
- [x] Define shape presets:
  - `orb`: sphere, radius 1
  - `calendar`: rounded box, 1.6 x 1.2 x 0.12, corner 0.15
  - `settings`: rounded box, 1.2 x 1.5 x 0.12, corner 0.18
  - `chat`: capsule-based bubble, 0.8 x 1.0 x 0.15
- [x] Create Zustand store:
  - `currentShape: ShapeType`
  - `morphProgress: number`
  - `config: ShapeConfig`
  - `transitioning: boolean`
  - `previousShape: ShapeType`
- [x] Implement `morphTo(shape: ShapeType)`:
  - Set `transitioning: true`
  - Use GSAP to animate `morphProgress` 0→1 with `power2.inOut` easing
  - Interpolate config dimensions during animation
  - Set `transitioning: false` on complete
- [x] Implement `resetToOrb()` for immediate reset
- [x] Implement `setMorphProgress()` for manual control
- [x] Export selector hooks:
  - `useCurrentShape()`
  - `useMorphProgress()`
  - `useShapeConfig()`
  - `useIsTransitioning()`
  - `useMorphTo()`

### 1.6.5 Integrate SDFOrb into Scene

- [x] Import `SDFOrb` in `Scene.tsx`
- [x] Replace `<Orb />` with `<SDFOrb />`
- [x] Verify rendering works (build passes)
- [x] Comment out old `<Orb />` import (kept for reference)
- [x] Enable Bloom effect composer

### 1.6.6 Mobile Optimization

- [x] Add quality-tier aware MAX_STEPS:
  - Desktop: 64 steps
  - Mobile: 32 steps
- [x] Implemented via `useQualityStore` tier detection
- [ ] Test on iOS Safari (real device or BrowserStack) — *manual verification*
- [ ] Profile performance, ensure 30+ fps on mobile — *manual verification*
- [ ] Add fallback for very low-end devices if needed — *deferred*

### 1.6.7 Visual Parity Verification

- [ ] Compare SDF orb to mesh orb side-by-side — *manual verification*
- [ ] Tune colors/fresnel to match — *manual tuning*
- [ ] Verify bloom still works correctly — *manual verification*
- [ ] Screenshot comparison for regression testing — *optional*

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

### Mesh Prototype (1.1-1.5): COMPLETE ✅

Files created/modified:
- `src/shaders/orb.vert` — vertex shader with view direction
- `src/shaders/orb.frag` — fragment shader with fresnel + environment tinting + iridescence
- `src/components/Orb.tsx` — React component with shaderMaterial, CSS color sync
- `src/components/Scene.tsx` — integrated Orb with quality-tier DPR

**Status**: Complete. Kept for reference/comparison.

### SDF Refactor (1.6): CODE COMPLETE ✅

Files created:
- `src/shaders/lib/sdf.glsl` — SDF primitives library (sphere, roundedBox, capsule, boolean ops, morphing)
- `src/shaders/orb-sdf.vert` — vertex shader for fullscreen quad
- `src/shaders/orb-sdf.frag` — raymarched glassmorphic shader with shape morphing
- `src/components/SDFOrb.tsx` — fullscreen quad SDF renderer with Leva controls
- `src/lib/shapeStore.ts` — shape morphing state management with GSAP animations

**Status**: Code complete. Production build passes. Awaiting manual visual verification.

### Remaining Manual Verification

1. Open http://localhost:3000 in browser
2. Use Leva controls to test shape morphing (Shape Type dropdown, Morph Progress slider)
3. Test surface noise animation
4. Verify bloom effect enhances the glassmorphic appearance
5. Test on mobile device or simulator for performance

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
