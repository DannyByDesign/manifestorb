# Phase 3: Internal Sparkles (GPU-First) — Restart Checklist

> **Goal**: Fluid "nuclear fission" particles floating inside the orb — continuous swirling currents that read like liquid fire, with obvious cursor interaction.
>
> **Prerequisite**: Phase 2 complete (SDF orb with glass styling)
>
> **Key change from failed attempt**: GPU-first approach. NO per-frame CPU particle loop. NO per-frame buffer upload. Positions computed entirely in vertex shader from static seeds + time uniform + GPU curl noise.

Each checkbox is a **single, one-dimensional problem**. Solve them in order.

---

## Why the Previous Implementation Failed

| Root Cause | Problem | Result |
|------------|---------|--------|
| **Degenerate curl noise** | CPU `simplex-noise` instances used constant RNG seeds (`() => 0.5`), producing correlated fields | Curl ≈ 0 → particles barely moved |
| **CPU loop overhead** | 10k particles × 12 noise calls = 120k evaluations/frame + buffer upload | FPS death → motion appeared frozen |
| **Broken pointer hit** | Ray-sphere used wrong radius (didn't match responsive orb size) | `discriminant < 0` → vortex never fired |
| **Flattened depth** | Mixed assumptions in `smoothstep()` with negative z values | Particles looked like flat disc |
| **Muddy visuals** | Weak white accents, low brightness, wrong color math | "Pepper dust" instead of "nuclear fission" |

## Additional Failure Modes to Avoid (Critical)

| Issue | Wrong Approach | Correct Approach |
|-------|----------------|------------------|
| **Shader includes** | `#include <noise>` — no such system exists | **Inline** all noise functions directly in sparkles.vert |
| **Coordinate space mismatch** | Assume orb at world origin | Compute orb center depth **in shader** via `modelViewMatrix * vec4(0,0,0,1)` |
| **Camera distance uniform** | `uCamDist = camera.position.length()` | Compute **in shader**: `orbCenterZ = -(modelViewMatrix * vec4(0,0,0,1)).z` |
| **Single-scale motion** | One curl layer = "dust wobble" | **Multi-scale flow**: domain warp + 2-layer curl + global swirl |
| **Missing position attribute** | Only `aSeedPos` → bounds/culling broken | Use standard `position` attribute (Three.js expects it) |

---

## Architecture: GPU-First Approach

```
┌─────────────────────────────────────────────────────────────────┐
│                     NEW: GPU-FIRST                              │
├─────────────────────────────────────────────────────────────────┤
│  INIT (once):                                                   │
│    → Create static buffers: position, aPhase, aIsWhite          │
│    → Use standard 'position' attribute (not custom aSeedPos)    │
│    → Never updated after creation                               │
│                                                                 │
│  EACH FRAME:                                                    │
│    CPU: Update 5 uniforms (~20 bytes)                           │
│      - uTime, uOrbRadius, uPointerLocal, uPointerEnergy,        │
│        uMorphFade                                               │
│    GPU: Vertex shader computes world position from seed + curl  │
│      - Orb center depth computed IN SHADER (not uniform)        │
│      - Multi-scale flow: domain warp + 2-layer curl + swirl     │
│    GPU: Fragment shader renders soft glow                       │
│                                                                 │
│  Result: Zero CPU loop, zero buffer upload → 60fps locked       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3.1 — Vertex Shader (GPU Multi-Scale Curl Advection)

> The vertex shader computes particle positions procedurally with coherent multi-scale flow.

### 3.1.1 Create shader file
- [ ] Create new file `src/shaders/sparkles.vert`

### 3.1.2 Inline noise functions (NO include system)
- [ ] Copy `mod289(vec3)`, `mod289(vec4)`, `permute()`, `taylorInvSqrt()` directly into file
- [ ] Copy `snoise(vec3)` function (simplex noise, returns -1 to 1)
- [ ] Copy `curlNoise(vec3)` function with offset seeds (31.416, 47.853, 63.291)
- [ ] Source: Copy from `src/shaders/orb.frag` lines 99-228 (proven working)
- [ ] **Critical**: Do NOT use `#include` — it doesn't exist in this build system

### 3.1.3 Define attributes (use standard names)
- [ ] `attribute vec3 position;` — standard Three.js attribute (seed position, never changes)
- [ ] `attribute float aPhase;` — random phase 0 to 2π for flicker timing
- [ ] `attribute float aIsWhite;` — 1.0 for white accent, 0.0 for base color (~7% chance)
- [ ] **Note**: Using `position` (not `aSeedPos`) so Three.js bounds/culling work correctly

### 3.1.4 Define uniforms
- [ ] `uniform float uTime;`
- [ ] `uniform float uOrbRadius;` — responsive orb radius (world space)
- [ ] `uniform vec3 uPointerLocal;` — 3D hit point in orb-local space (or sentinel vec3(0,0,-999))
- [ ] `uniform float uPointerEnergy;` — 0-1 based on pointer velocity magnitude
- [ ] `uniform float uMorphFade;` — 1.0 when orb visible, 0.0 when morphed
- [ ] **No uCamDist** — computed in shader instead

### 3.1.5 Define varyings (passed to fragment)
- [ ] `varying float vDepthFade;` — 1.0 = near/bright, 0.0 = far/dim
- [ ] `varying float vPhase;` — pass phase for fragment flicker
- [ ] `varying float vIsWhite;` — pass white accent flag
- [ ] `varying float vMorphFade;` — pass morph visibility

### 3.1.6 Implement multi-scale flow (domain warp + 2-layer curl + swirl)
```glsl
// Step 1: Domain warp — warp the seed position before curl sampling
vec3 seed = position;  // unit sphere position
vec3 warpOffset = curlNoise(seed * 0.5 + uTime * 0.02) * 0.15;
vec3 warpedSeed = seed + warpOffset;

// Step 2: Large-scale slow curl (creates coherent currents)
vec3 largeCurl = curlNoise(warpedSeed * 1.2 + uTime * 0.05) * 0.3;

// Step 3: Small-scale fast curl (adds detail/turbulence)
vec3 smallCurl = curlNoise(warpedSeed * 3.0 + uTime * 0.15) * 0.08;

// Step 4: Global swirl (gentle rotation around Y axis)
float swirlAngle = uTime * 0.03;
float swirl = length(seed.xz) * 0.1; // stronger at edges
vec3 swirlOffset = vec3(
  -seed.z * sin(swirlAngle) * swirl,
  0.0,
  seed.x * sin(swirlAngle) * swirl
);

// Combine: base position + all flow layers
vec3 localPos = seed * 0.72 + largeCurl + smallCurl + swirlOffset;
```
- [ ] Implement domain warp (warpOffset)
- [ ] Implement large-scale curl (slow, coherent currents)
- [ ] Implement small-scale curl (fast, detail turbulence)
- [ ] Implement global swirl (rotation around Y)
- [ ] Combine all layers

### 3.1.7 Implement vortex injection (in local space)
- [ ] Check if pointer active: `if (uPointerLocal.z > -900.0) { ... }`
- [ ] Calculate vector to pointer: `vec3 toPointer = localPos - uPointerLocal;`
- [ ] Calculate distance: `float dist = length(toPointer);`
- [ ] Calculate tangent: `vec3 tangent = normalize(cross(toPointer, vec3(0.0, 1.0, 0.0)));`
- [ ] Handle edge case: `if (length(tangent) < 0.001) tangent = vec3(1.0, 0.0, 0.0);`
- [ ] Calculate falloff: `float vortexFalloff = smoothstep(0.5, 0.0, dist) * uPointerEnergy * 0.4;`
- [ ] Apply tangential offset: `localPos += tangent * vortexFalloff;`

### 3.1.8 Scale to orb radius and clamp boundary
- [ ] Scale: `vec3 worldPos = localPos * uOrbRadius;`
- [ ] Get current radius: `float r = length(worldPos);`
- [ ] Soft clamp: `if (r > uOrbRadius * 0.9) worldPos = normalize(worldPos) * uOrbRadius * 0.9;`

### 3.1.9 Compute orb center depth IN SHADER (not from uniform)
```glsl
// Orb center in view space — handles any transform
vec4 orbCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
float orbCenterZ = -orbCenterView.z;  // positive depth
```
- [ ] Transform orb center (0,0,0) to view space via modelViewMatrix
- [ ] Extract positive depth: `orbCenterZ = -orbCenterView.z`
- [ ] **Critical**: Do NOT pass camera distance as uniform

### 3.1.10 Implement depth fade (correct view-space math)
```glsl
vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
float particleZ = -mvPos.z;  // positive depth

// Depth range: near = orbCenter - radius, far = orbCenter + radius
float zNear = orbCenterZ - uOrbRadius;
float zFar = orbCenterZ + uOrbRadius;

// Fade: 1.0 at front (near), 0.0 at back (far)
vDepthFade = 1.0 - smoothstep(zNear, zFar, particleZ);
```
- [ ] Transform particle to view space
- [ ] Extract positive depth
- [ ] Compute depth range from orb center
- [ ] Calculate fade with smoothstep

### 3.1.11 Implement point size
- [ ] Base size from depth: `float baseSize = mix(1.5, 5.0, vDepthFade);`
- [ ] Apply perspective: `gl_PointSize = baseSize * (250.0 / particleZ);`
- [ ] Clamp: `gl_PointSize = clamp(gl_PointSize, 1.0, 12.0);`

### 3.1.12 Pass varyings and finalize
- [ ] Pass phase: `vPhase = aPhase;`
- [ ] Pass white flag: `vIsWhite = aIsWhite;`
- [ ] Pass morph fade: `vMorphFade = uMorphFade;`
- [ ] Set position: `gl_Position = projectionMatrix * mvPos;`

### 3.1.13 Verify shader compiles
- [ ] Run `bun run build` to check for GLSL errors

---

## 3.2 — Fragment Shader (Soft Glow + Depth)

> Fragment shader renders soft circular points with depth-based brightness.

### 3.2.1 Create shader file
- [ ] Create new file `src/shaders/sparkles.frag`

### 3.2.2 Define precision and uniforms
- [ ] Add `precision highp float;`
- [ ] `uniform float uTime;`
- [ ] `uniform vec3 uBaseColor;` — saturated particle color (coral/pink)

### 3.2.3 Define varyings (from vertex)
- [ ] `varying float vDepthFade;`
- [ ] `varying float vPhase;`
- [ ] `varying float vIsWhite;`
- [ ] `varying float vMorphFade;`

### 3.2.4 Implement circular point shape
- [ ] Get UV from point coord: `vec2 uv = gl_PointCoord - 0.5;`
- [ ] Calculate distance from center: `float dist = length(uv);`
- [ ] Discard outside circle: `if (dist > 0.5) discard;`

### 3.2.5 Implement soft glow falloff
- [ ] Calculate glow: `float glow = 1.0 - smoothstep(0.0, 0.5, dist);`
- [ ] Sharpen center: `glow = glow * glow;`

### 3.2.6 Implement flicker
- [ ] Calculate per-particle twinkle: `float flicker = 0.75 + 0.25 * sin(uTime * 4.0 + vPhase * 6.28);`
- [ ] Flicker range is 0.75 to 1.0 (subtle, not strobe)

### 3.2.7 Implement brightness calculation
- [ ] Base brightness from depth + flicker: `float brightness = vDepthFade * flicker;`
- [ ] Boost for white accents: `brightness *= mix(1.3, 2.5, vIsWhite);`
- [ ] **Critical**: White accents need strong boost (2.5x) to POP

### 3.2.8 Implement color selection
- [ ] Define white color: `vec3 white = vec3(1.0, 0.97, 0.9);` (warm white)
- [ ] Mix based on flag: `vec3 color = mix(uBaseColor, white, vIsWhite);`
- [ ] Apply brightness and glow: `color *= brightness * glow * 1.4;` (overall boost)

### 3.2.9 Implement alpha calculation
- [ ] Base alpha from depth: `float alpha = vDepthFade * glow * vMorphFade;`
- [ ] Boost minimum alpha: `alpha = max(alpha, 0.15 * vMorphFade);` (particles never fully invisible)
- [ ] White accents more opaque: `alpha *= mix(0.8, 1.0, vIsWhite);`

### 3.2.10 Output final color
- [ ] Set fragment color: `gl_FragColor = vec4(color, alpha);`

### 3.2.11 Verify shader compiles
- [ ] Run `bun run build` to check for GLSL errors

---

## 3.3 — Sparkles Component (Static Buffers)

> Create geometry with static attributes that never change after init.

### 3.3.1 Create component file
- [ ] Create new file `src/components/Sparkles.tsx`
- [ ] Add `"use client"` directive at top

### 3.3.2 Add imports
- [ ] Import React: `useMemo`, `useRef`
- [ ] Import R3F: `useFrame`, `useThree`
- [ ] Import THREE: `* as THREE`
- [ ] Import stores: `useQualityStore` from `@/lib/qualityStore`
- [ ] Import stores: `useShapeStore` from `@/lib/shapeStore`
- [ ] Import Leva: `useControls`, `folder`

### 3.3.3 Define particle count constants
- [ ] `const PARTICLE_COUNT_DESKTOP = 8000;`
- [ ] `const PARTICLE_COUNT_MOBILE = 2500;`
- [ ] Reduced from failed attempt to ensure headroom

### 3.3.4 Determine particle count from quality tier
- [ ] Get tier: `const tier = useQualityStore((s) => s.tier);`
- [ ] Calculate count: `const particleCount = tier.tierName === 'mobile' ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;`

### 3.3.5 Create position buffer (STATIC) — use standard "position" name
- [ ] Create in useMemo with `[particleCount]` dependency
- [ ] Size: `Float32Array(particleCount * 3)`
- [ ] Initialize with random points inside unit sphere:
  - `theta = Math.random() * 2 * Math.PI`
  - `phi = Math.acos(2 * Math.random() - 1)`
  - `r = Math.cbrt(Math.random()) * 0.85` (cube root for uniform volume)
  - `x = r * sin(phi) * cos(theta)`, `y = r * cos(phi)`, `z = r * sin(phi) * sin(theta)`
- [ ] **Critical**: Use name `position` (not `aSeedPos`) for Three.js bounds/culling

### 3.3.6 Create phase buffer (STATIC)
- [ ] Create in useMemo with `[particleCount]` dependency
- [ ] Size: `Float32Array(particleCount)`
- [ ] Initialize: `Math.random() * Math.PI * 2` for each particle

### 3.3.7 Create white accent buffer (STATIC)
- [ ] Create in useMemo with `[particleCount]` dependency
- [ ] Size: `Float32Array(particleCount)`
- [ ] Initialize: `Math.random() < 0.07 ? 1.0 : 0.0` (~7% white accents)

### 3.3.8 Create BufferGeometry with STANDARD position attribute
- [ ] Create in useMemo with buffer dependencies
- [ ] Create geometry: `new THREE.BufferGeometry()`
- [ ] Add position: `geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))`
- [ ] Add phase: `geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))`
- [ ] Add white flag: `geometry.setAttribute('aIsWhite', new THREE.BufferAttribute(isWhite, 1))`
- [ ] **Note**: Using `position` ensures Three.js computes correct bounding sphere for culling
- [ ] Return geometry

### 3.3.9 Compute bounding sphere manually (for frustum culling)
- [ ] After creating geometry: `geometry.computeBoundingSphere();`
- [ ] This tells Three.js the spatial extent of the particles

### 3.3.10 Verify buffer setup compiles
- [ ] Run `bun run build` to check for TypeScript errors

---

## 3.4 — Shader Material Setup

> Create ShaderMaterial with uniforms that update each frame.

### 3.4.1 Import shaders
- [ ] `import vertexShader from '@/shaders/sparkles.vert';`
- [ ] `import fragmentShader from '@/shaders/sparkles.frag';`

### 3.4.2 Create uniforms object (NO uCamDist — computed in shader)
- [ ] Create in useMemo (no dependencies, created once):
  ```typescript
  {
    uTime: { value: 0 },
    uOrbRadius: { value: 1.0 },
    uPointerLocal: { value: new THREE.Vector3(0, 0, -999) },  // sentinel = inactive
    uPointerEnergy: { value: 0 },
    uMorphFade: { value: 1.0 },
    uBaseColor: { value: new THREE.Color(0.85, 0.45, 0.35) }  // warm coral
  }
  ```
- [ ] **Note**: No `uCamDist` — orb center depth computed IN SHADER via modelViewMatrix

### 3.4.3 Create ShaderMaterial
- [ ] Create in useMemo with `[uniforms]` dependency
- [ ] Pass `vertexShader`, `fragmentShader`, `uniforms`
- [ ] Set `transparent: true`
- [ ] Set `depthWrite: false`
- [ ] Set `blending: THREE.AdditiveBlending`

### 3.4.4 Create refs
- [ ] `const materialRef = useRef<THREE.ShaderMaterial>(null);`
- [ ] `const pointsRef = useRef<THREE.Points>(null);`

### 3.4.5 Verify material setup compiles
- [ ] Run `bun run build`

---

## 3.5 — Pointer Ray-Sphere Intersection (Orb-Local Space)

> Compute 3D pointer position in orb-local coordinates (normalized unit sphere).

### 3.5.1 Create module-scope Raycaster (ONCE)
- [ ] Outside component: `const raycaster = new THREE.Raycaster();`
- [ ] **Critical**: Do NOT create per frame (causes GC jitter)

### 3.5.2 Create module-scope temp vectors (ONCE)
- [ ] `const tempHitPoint = new THREE.Vector3();`
- [ ] `const tempLocalHit = new THREE.Vector3();`

### 3.5.3 Create ray-sphere intersection helper (returns LOCAL coordinates)
- [ ] Function signature: `function rayToSphereLocal(camera: THREE.Camera, pointer: THREE.Vector2, radius: number): THREE.Vector3 | null`
- [ ] Set up ray: `raycaster.setFromCamera(pointer, camera);`
- [ ] Get ray: `const { origin, direction } = raycaster.ray;`
- [ ] Compute quadratic coefficients (sphere at world origin):
  - `a = direction.dot(direction)` (always 1 for normalized direction)
  - `b = 2 * origin.dot(direction)`
  - `c = origin.dot(origin) - radius * radius`
- [ ] Compute discriminant: `disc = b*b - 4*a*c`
- [ ] If `disc < 0`: return `null` (no hit)
- [ ] Compute t: `t = (-b - Math.sqrt(disc)) / (2*a)`
- [ ] Compute world hit: `tempHitPoint.copy(direction).multiplyScalar(t).add(origin)`
- [ ] **Convert to local (unit sphere)**: `tempLocalHit.copy(tempHitPoint).divideScalar(radius)`
- [ ] Nudge inward: `tempLocalHit.multiplyScalar(0.85)` (vortex well inside orb)
- [ ] Return `tempLocalHit.clone()`

### 3.5.4 Track pointer velocity for energy
- [ ] Create ref for previous pointer: `const prevPointer = useRef({ x: 0, y: 0 });`
- [ ] In useFrame: compute velocity `vx = pointer.x - prevPointer.current.x`
- [ ] Compute velocity `vy = pointer.y - prevPointer.current.y`
- [ ] Calculate energy: `Math.min(1, Math.sqrt(vx*vx + vy*vy) * 20)`
- [ ] Update prevPointer ref: `prevPointer.current = { x: pointer.x, y: pointer.y }`

### 3.5.5 Verify ray-sphere math is correct
- [ ] Add temporary console.log: `console.log('hit:', localHit)`
- [ ] Confirm hit points are in range [-1, 1] (unit sphere)
- [ ] Confirm hit is null when cursor is outside orb area
- [ ] Remove console.log after verification

---

## 3.6 — useFrame Uniform Updates

> Update uniforms each frame (minimal CPU work — NO camera distance uniform).

### 3.6.1 Get responsive radius
- [ ] Replicate `getResponsiveRadius()` from Orb.tsx or extract to shared util
- [ ] Calculate: `const responsiveRadius = getResponsiveRadius(size.width, 1.0);`

### 3.6.2 Get morph progress
- [ ] `const morphProgress = useShapeStore((s) => s.morphProgress);`

### 3.6.3 Implement useFrame
- [ ] Early return if material not ready: `if (!materialRef.current) return;`
- [ ] Get uniforms: `const u = materialRef.current.uniforms;`

### 3.6.4 Update time uniform
- [ ] `u.uTime.value = state.clock.elapsedTime;`

### 3.6.5 Update orb radius uniform
- [ ] `u.uOrbRadius.value = responsiveRadius;`

### 3.6.6 Update morph fade uniform
- [ ] `u.uMorphFade.value = 1.0 - morphProgress;`

### 3.6.7 Compute pointer velocity and energy
- [ ] Get R3F pointer: `const { pointer } = state;`
- [ ] Compute velocity: `const vx = pointer.x - prevPointer.current.x;`
- [ ] Compute velocity: `const vy = pointer.y - prevPointer.current.y;`
- [ ] Compute energy: `const energy = Math.min(1, Math.sqrt(vx*vx + vy*vy) * 20);`
- [ ] Update prev: `prevPointer.current = { x: pointer.x, y: pointer.y };`

### 3.6.8 Compute pointer hit in LOCAL space
- [ ] Call ray-sphere: `const localHit = rayToSphereLocal(state.camera, pointer, responsiveRadius);`
- [ ] **Note**: Returns unit-sphere coordinates (already normalized by radius)

### 3.6.9 Update pointer uniforms
- [ ] If hit: `u.uPointerLocal.value.copy(localHit);`
- [ ] If no hit: `u.uPointerLocal.value.set(0, 0, -999);` (sentinel)
- [ ] Update energy: `u.uPointerEnergy.value = energy;`
- [ ] **Note**: No uCamDist update — computed in shader

### 3.6.10 Update base color from Leva
- [ ] Parse Leva color string to THREE.Color
- [ ] `u.uBaseColor.value.set(controls.baseColor);`

### 3.6.11 Verify uniform updates work
- [ ] Temporarily log: `console.log('localHit:', localHit, 'energy:', energy);`
- [ ] Confirm local hit is in [-1, 1] range
- [ ] Confirm energy spikes when moving cursor quickly
- [ ] Remove log after verification

---

## 3.7 — Leva Debug Controls

> Add controls for tuning visuals.

### 3.7.1 Create Sparkles Leva folder
- [ ] `const controls = useControls({ Sparkles: folder({ ... }, { collapsed: true }) });`

### 3.7.2 Add enabled toggle
- [ ] `enabled: { value: true, label: "Enabled" }`

### 3.7.3 Add base color control
- [ ] `baseColor: { value: "#d97350", label: "Base Color" }` — warm coral

### 3.7.4 Implement conditional rendering
- [ ] If `!controls.enabled`: return `null`

### 3.7.5 Verify Leva controls work
- [ ] Toggle enabled on/off
- [ ] Change color and see update

---

## 3.8 — Render Points Component

> Final JSX to render the particles.

### 3.8.1 Return Points JSX
```tsx
return (
  <points ref={pointsRef}>
    <primitive object={geometry} attach="geometry" />
    <primitive object={material} attach="material" ref={materialRef} />
  </points>
);
```

### 3.8.2 Verify particles render
- [ ] Run `bun run dev`
- [ ] Particles should appear inside orb

---

## 3.9 — Scene Integration

> Add Sparkles to the main scene.

### 3.9.1 Import Sparkles in Scene.tsx
- [ ] `import { Sparkles } from '@/components/Sparkles';`

### 3.9.2 Add Sparkles after Orb
- [ ] In Scene component JSX: `<Sparkles />`
- [ ] Place after `<Orb />` (renders in same 3D space)

### 3.9.3 Verify integration
- [ ] Run dev server
- [ ] Sparkles should appear inside/around orb
- [ ] Particles should swirl continuously

---

## 3.10 — Validation Checklist

> Final verification before marking Phase 3 complete.

### 3.10.1 Visual: Fluid motion
- [ ] Particles visibly swirl and flow when page loads
- [ ] Motion is continuous, not static or jittery
- [ ] Movement feels like "liquid fire" or "nuclear fission"

### 3.10.2 Visual: Cursor interaction
- [ ] Moving cursor over orb creates visible vortex/stirring
- [ ] Particles flow tangentially around cursor (swirl, not push)
- [ ] Effect is OBVIOUS, not subtle

### 3.10.3 Visual: White accents
- [ ] White sparkles are clearly visible (not muddy)
- [ ] ~7% of particles are bright white
- [ ] White particles POP against base color

### 3.10.4 Visual: Base color
- [ ] Base particles are vibrant coral/pink (not muddy brown)
- [ ] Color matches or complements background gradient

### 3.10.5 Visual: 3D depth
- [ ] Front particles are larger and brighter
- [ ] Back particles are smaller and dimmer
- [ ] Clear sense of 3D volume (not flat disc)

### 3.10.6 Visual: Morph fade
- [ ] Trigger shape morph via Leva `morphProgress`
- [ ] Particles fade to invisible during morph
- [ ] Particles return when morphing back

### 3.10.7 Visual: Orb containment
- [ ] No particles escape outside the orb boundary
- [ ] Particles stay within ~92% of orb radius

### 3.10.8 Performance: Desktop
- [ ] Chrome DevTools shows stable 60fps
- [ ] No "Long Task" warnings
- [ ] CPU usage is minimal (no loop overhead)

### 3.10.9 Performance: Mobile
- [ ] Test on real iOS device or simulator
- [ ] 30+ fps with reduced particle count
- [ ] No visible stuttering

### 3.10.10 Build verification
- [ ] `bun run build` completes without errors
- [ ] Production build runs correctly

---

## Summary

| Section | Tasks | Key Deliverable |
|---------|-------|-----------------|
| 3.1 | 13 | `sparkles.vert` — multi-scale curl + vortex (inlined noise) |
| 3.2 | 11 | `sparkles.frag` — soft glow + depth fade |
| 3.3 | 10 | Static geometry with standard `position` attribute |
| 3.4 | 5 | ShaderMaterial (no uCamDist uniform) |
| 3.5 | 5 | Ray-sphere intersection returning LOCAL coords |
| 3.6 | 11 | useFrame uniform updates |
| 3.7 | 5 | Leva debug controls |
| 3.8 | 2 | Points JSX rendering |
| 3.9 | 3 | Scene integration |
| 3.10 | 10 | Validation checklist |

**Total: ~75 atomic tasks**

**Estimated effort: 3-4 hours**

---

## Critical Implementation Details (Avoid These Failure Modes)

| Issue | Wrong | Correct |
|-------|-------|---------|
| **Noise functions** | `#include <noise>` | **Inline** all functions in sparkles.vert (copy from orb.frag) |
| **Position attribute** | Custom `aSeedPos` | Standard `position` (Three.js needs it for bounds) |
| **Camera distance** | `uCamDist = camera.position.length()` | Compute **in shader**: `orbCenterZ = -(modelViewMatrix * vec4(0,0,0,1)).z` |
| **Pointer hit space** | World coordinates | **Local** unit-sphere coords (divide by radius) |
| **Motion quality** | Single curl layer | Multi-scale: domain warp + 2-layer curl + global swirl |

---

## Key Differences from Failed Implementation

| Aspect | Failed (CPU) | Restart (GPU) |
|--------|--------------|---------------|
| Position computation | CPU loop each frame | Vertex shader procedural |
| Buffer upload | 10k * 3 floats/frame | Zero (static buffers) |
| Noise evaluations | 120k CPU calls/frame | ~8k GPU parallel calls |
| Motion quality | Single-scale "dust wobble" | Multi-scale "liquid fission" |
| Pointer hit | Wrong space, often null | Local unit-sphere coords |
| Depth fade | Wrong z assumptions | Orb center computed in shader |
| White accents | 1.2x brightness | **2.5x** brightness boost |
| Vortex | Never fired | Tangential swirl in local space |

---

## Files to Create

1. `src/shaders/sparkles.vert` — Vertex shader with **inlined noise**, multi-scale flow
2. `src/shaders/sparkles.frag` — Fragment shader with soft glow
3. `src/components/Sparkles.tsx` — Points component with standard `position` attribute

## Files to Modify

1. `src/components/Scene.tsx` — Add `<Sparkles />` after `<Orb />`

---

## Reference: Noise Functions to Inline

Copy these functions from `src/shaders/orb.frag` (lines 99-228) directly into `sparkles.vert`:

```glsl
// Required functions (in order):
vec3 mod289(vec3 x) { ... }
vec4 mod289(vec4 x) { ... }
vec4 permute(vec4 x) { ... }
vec4 taylorInvSqrt(vec4 r) { ... }
float snoise(vec3 v) { ... }           // ~60 lines
vec3 curlNoise(vec3 p) { ... }         // ~30 lines, uses offset seeds
```

The curlNoise function uses **offset seeds** (31.416, 47.853, 63.291) to create independent noise fields, which avoids the collapsed randomness issue from the failed CPU implementation.
