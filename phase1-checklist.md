# Phase 1: Static Orb Rendering — Atomic Checklist

> **Goal**: Render a beautiful pink orb with fresnel rim and soft gradient, no audio reactivity yet.

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

## Verification Checklist

After all tasks complete, manually verify in browser (`bun dev`):

- [ ] Orb renders centered in viewport
- [ ] Orb is pink with visible color gradient
- [ ] Fresnel rim visible (lighter edge when viewed at angle)
- [ ] Core appears slightly different color than edges
- [ ] Bloom creates soft glow around orb
- [ ] No console errors
- [x] No TypeScript errors in build ✅

---

## Summary

**Phase 1 Code Implementation: COMPLETE** ✅

Files created/modified:
- `src/shaders/orb.vert` — vertex shader with view direction
- `src/shaders/orb.frag` — fragment shader with fresnel + gradient
- `src/components/Orb.tsx` — React component with shaderMaterial
- `src/components/OrbCanvas.tsx` — integrated Orb, tuned Bloom

**Remaining**: Manual browser verification of visual output.
