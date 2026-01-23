# Audio-Reactive Orb Implementation Plan

## Reference Target

![Reference orb visualization](file:///Users/dannywang/.gemini/antigravity/brain/ad9afe38-88b8-4a1f-b9b3-71f88d37c147/uploaded_image_1769133940834.png)

> **Target**: Light pink hue orb with glowing particle halo, audio-reactive displacement, and cursor-driven fluid particle motion.

---

## Grand Vision: Shape-Morphing Glassmorphic UI

> [!IMPORTANT]
> The orb is not just a visualization — it's the **foundation of a shape-morphing UI system**.

The orb will evolve beyond an audio-reactive sphere into a **glassmorphic container** that can organically transform into different modal shapes (calendar, settings, chat, etc.). This requires architectural decisions made early to avoid costly rewrites.

### Future Transformation Flow

```
┌─────────────────┐     organic morph      ┌─────────────────────┐
│   Talking Orb   │  ─────────────────────▶│  Calendar Modal     │
│   (sphere)      │                        │  (rounded rectangle)│
│                 │                        │                     │
│  • particles    │     particles fade     │  • glassmorphic     │
│  • audio react  │     or animate to      │  • same shader feel │
│  • sparkles     │     target positions   │  • content inside   │
└─────────────────┘                        └─────────────────────┘
```

### Shape Morphing Requirements

| Requirement | Implication |
|-------------|-------------|
| Sphere ↔ Rounded Rectangle | Can't use fixed mesh topology |
| Organic grow/shrink transitions | Need mathematical shape definitions |
| Glassmorphic texture on any shape | Shader must work with any geometry |
| Particles → UI elements (stretch goal) | Particles need target position system |

### Why SDF (Signed Distance Functions)?

Traditional mesh-based rendering (sphereGeometry) **cannot** support organic shape morphing. SDFs solve this:

```glsl
// With SDFs, morphing is trivial:
float sphere = sdSphere(p, 1.0);
float modal = sdRoundedBox(p, vec3(2.0, 1.5, 0.1), 0.2);
float shape = mix(sphere, modal, uMorphProgress); // smooth morph!
```

**Benefits of SDF approach:**
- Define shapes mathematically — morph between ANY shapes
- Smooth blending via `smin()` for organic transitions
- Normals calculated analytically (no mesh required)
- Resolution-independent rendering
- Easy to add new shapes (calendar, settings panel, etc.)

---

## Architecture Decisions

### Mobile-First Performance Strategy

> [!IMPORTANT]
> Performance constraints are enforced from Phase 0, not retrofitted later.

| Tier | Sim Resolution | Particles | DPR Clamp | Float Textures |
|------|----------------|-----------|-----------|----------------|
| **Mobile** (default) | 256×256 | 30k–60k | 1.25–1.5 | Half-float fallback |
| **Desktop** | 512×512 | 100k–200k | 2.0 | Full float |

**Fallback path** when float targets unsupported:
- No fluid sim → use **curl-noise velocity field** (still cursor-reactive)
- Particles remain GPU-driven, just simpler velocity source

### Sparkle Architecture

| Layer | Implementation | Why |
|-------|----------------|-----|
| **Internal sparkles** | `orb.frag` shader | Cheapest, stable on mobile, volume-contained |
| **External halo** | `Particles.tsx` + GPU sim | Fluid-advected points, additive blend |

Both layers share a **unified cursor interaction field**:
```glsl
uniform vec2 uPointer;       // normalized UV
uniform vec2 uPointerVel;    // delta per frame
uniform float uCursorEnergy; // clamp(length(pointerVel) * gain, 0, 1)
```

- **Internal sparkles**: `uCursorEnergy` increases local turbulence
- **Halo particles**: Fluid sim receives pointer splats

### Visual Layers

| Element | Rendering | Details |
|---------|-----------|---------|
| Background | CSS gradient | Static, full-screen, cheapest |
| Orb / Modal | Raymarched SDF | Glassmorphic, shape-morphing, fresnel rim, iridescence |
| Internal Sparkles | Volumetric (in SDF shader) | Accumulated along raymarch, cursor-reactive |
| Particles (Halo) | WebGL points | White/pink, additive blend, fluid-advected |

### Audio Source Design

```
useAudio hook
├── source: 'mic' | 'playback'
├── connectMic() → MediaStream analyser
└── connectPlayback(audioEl) → AudioElement analyser
                                 ↑
                        (ElevenLabs TTS later)
```

### SDF-Based Rendering Architecture

> [!IMPORTANT]
> The orb uses **raymarched SDFs** instead of mesh geometry. This is foundational for shape morphing.

| Aspect | Mesh Approach (❌ rejected) | SDF Approach (✅ chosen) |
|--------|----------------------------|-------------------------|
| Shape definition | Fixed vertex topology | Mathematical functions |
| Morphing | Vertex interpolation (ugly) | `mix()` / `smin()` (smooth) |
| New shapes | New geometry + UV mapping | Add SDF function |
| Normals | From mesh (fixed) | From SDF gradient (dynamic) |
| Mobile fallback | N/A | Reduce raymarch steps |

**Rendering pipeline:**
```
Fullscreen Quad → Raymarch SDF → Calculate Normal → Glassmorphic Shading → Output
```

**Shape state management:**
```ts
// src/lib/shapeStore.ts
interface ShapeState {
  currentShape: 'orb' | 'calendar' | 'settings' | 'chat';
  morphProgress: number;      // 0..1 animated by GSAP
  targetDimensions: vec3;     // width, height, depth
  cornerRadius: number;       // for rounded rectangles
}
```

---

## Implementation Phases

### Phase 0: Infrastructure + Mobile-First Setup
**Goal**: Shader loading, shared utilities, and capability detection from day one.

- [ ] **0.1** Create `src/shaders/lib/noise.glsl` — simplex/perlin 3D noise
- [ ] **0.2** Create `src/shaders/lib/common.glsl` — shared uniforms & math
- [ ] **0.3** Configure shader imports (raw-loader or import assertions for `.glsl`)
- [ ] **0.4** Create `src/shaders/sim/passthrough.vert` — fullscreen quad
- [ ] **0.5** Update `globals.css` — static gradient background (creamy peach → soft pink)
- [ ] **0.6** Create `src/lib/capabilities.ts` — capability detection + quality tiers:
  - Detect WebGL2 support
  - Detect float render target support
  - Detect linear filtering on float textures
  - **Only enable fluid sim if both float RT + linear filtering are supported**
  - Export quality presets: `{ simRes, particleCount, dprClamp, useFluidSim }`
  - Fallback: `useFluidSim: false` → curl-noise velocity field
- [ ] **0.7** Create `src/lib/qualityStore.ts` (Zustand) — global quality tier state

**Verification**: `console.log(capabilities)` shows correct tier on desktop vs iOS Safari.

---

### Phase 1: Static Orb Rendering (Mesh Prototype)
**Goal**: Beautiful glassmorphic orb with fresnel rim — mesh-based prototype before SDF refactor.

> [!NOTE]
> Phase 1 uses mesh geometry as a rapid prototype. Phase 1.5 refactors to SDF for shape morphing support.

- [x] **1.1** Implement `orb.vert` — passthrough with normals, UV, view direction
- [x] **1.2** Implement `orb.frag`:
  - Base: glassmorphic neutral with environment tinting
  - Rim: fresnel-based edge lighting
  - Holographic iridescence on grazing angles
- [x] **1.3** Create `src/components/Orb.tsx` with `shaderMaterial`
  - Uniforms: `uTime`, `uBaseColor`, `uCoolColor`, `uWarmColor`
  - CSS variable color syncing for palette flexibility
- [x] **1.4** Integrate into `Scene.tsx` with quality-tier DPR
- [ ] **1.5** Tune Bloom for soft ethereal glow
- [ ] **1.6** Visual verification and color tuning

**Verification**: Glassmorphic orb renders centered with iridescent rim and environment tinting.

---

### Phase 1.5: SDF Architecture Refactor
**Goal**: Replace mesh-based orb with raymarched SDF to enable future shape morphing.

> [!IMPORTANT]
> This refactor is **critical** for the grand vision. Do not skip.

- [ ] **1.5.1** Create `src/shaders/lib/sdf.glsl` — SDF primitives library:
  - `sdSphere(p, radius)` — sphere
  - `sdRoundedBox(p, dimensions, cornerRadius)` — modal shapes
  - `sdCapsule(p, a, b, radius)` — pill shapes
  - `opSmoothUnion(d1, d2, k)` — organic blending (uses `smin`)
  - `opSmoothSubtraction(d1, d2, k)` — carving
  - `opMorph(d1, d2, t)` — linear shape interpolation

- [ ] **1.5.2** Create `src/shaders/orb-sdf.frag` — raymarched orb shader:
  - Ray setup from camera through fullscreen quad
  - Raymarching loop with configurable max steps (mobile: 32, desktop: 64)
  - Early exit optimization
  - Normal calculation from SDF gradient
  - Port glassmorphic shading from `orb.frag`:
    - Fresnel rim lighting
    - Environment gradient mapping
    - Holographic iridescence

- [ ] **1.5.3** Add shape morphing uniforms:
  - `uniform int uShapeType;` — 0=sphere, 1=roundedBox, 2=capsule...
  - `uniform float uMorphProgress;` — 0..1 blend factor
  - `uniform vec3 uShapeDimensions;` — target shape size
  - `uniform float uCornerRadius;` — for rounded rectangles
  - `uniform float uSurfaceNoise;` — organic surface perturbation

- [ ] **1.5.4** Create `src/components/SDFOrb.tsx`:
  - Fullscreen quad rendering (use drei's `<ScreenQuad>` or custom)
  - Proper camera/ray uniform setup
  - Animate `uMorphProgress` with GSAP for testing

- [ ] **1.5.5** Create `src/lib/shapeStore.ts` (Zustand):
  - `currentShape: 'orb' | 'calendar' | 'settings' | 'chat'`
  - `morphProgress: number`
  - `targetDimensions: { width, height, depth }`
  - `cornerRadius: number`
  - `morphTo(shape)` — triggers GSAP animation

- [ ] **1.5.6** Mobile fallback path:
  - Reduce raymarch steps (32 vs 64)
  - Simpler normal estimation if needed
  - Test on iOS Safari

- [ ] **1.5.7** Replace `<Orb />` with `<SDFOrb />` in Scene

**Verification**:
- Orb renders identically to mesh version (visual parity)
- Can smoothly morph sphere ↔ rounded box via Leva controls
- 60fps on desktop, 30+ fps on mobile
- Glassmorphic shading works on morphed shapes

---

### Phase 2: SDF Surface Animation (Noise)
**Goal**: Organic procedural surface animation via SDF perturbation.

> [!NOTE]
> With SDFs, surface animation is done by perturbing the distance field, not displacing vertices.

- [ ] **2.1** Integrate `noise.glsl` into `orb-sdf.frag`
- [ ] **2.2** Add uniforms: `uNoiseScale`, `uNoiseSpeed`, `uDisplacementAmp`
- [ ] **2.3** Perturb SDF with noise before raymarching:
  ```glsl
  float d = sdShape(p, ...);
  d += snoise(p * uNoiseScale + uTime * uNoiseSpeed) * uDisplacementAmp;
  ```
- [ ] **2.4** Ensure noise perturbation works across shape morphs
- [ ] **2.5** Add audio-reactive displacement amplitude (prep for Phase 4)

**Verification**: Orb surface undulates gently like an organic blob, works during shape morphing.

---

### Phase 3: Internal Sparkles (Raymarched Volume)
**Goal**: Volume-contained glitter inside orb, cursor-reactive.

> [!NOTE]
> With raymarching, internal sparkles are sampled along the ray inside the SDF volume — more natural than mesh approach.

- [ ] **3.1** In `orb-sdf.frag`, add volumetric sparkle accumulation:
  - During raymarch, sample sparkle density inside shape (where SDF < 0)
  - Generate sparkle points via 3D noise hash in object space
  - Accumulate sparkle contribution along ray
- [ ] **3.2** Animate sparkles with smooth flow:
  ```glsl
  vec3 sparkleP = p + curlNoise(p * 0.5 + uTime * 0.1) * 0.3;
  float sparkle = pow(snoise(sparkleP * 20.0), 8.0);
  ```
- [ ] **3.3** React to cursor via `uCursorEnergy`:
  - Bias internal flow field toward cursor-facing region
  - Increase sparkle intensity near cursor
- [ ] **3.4** Ensure sparkles work across ALL shape morphs (sphere, modal, etc.)
- [ ] **3.5** Tune sparkle density, brightness, animation speed

**Verification**: Sparkles visible inside orb AND inside morphed modal shapes, intensify when cursor nearby.

---

### Phase 4: Audio Integration
**Goal**: Connect Web Audio to orb for Siri-like reactivity.

- [ ] **4.1** Create `src/hooks/useAudio.ts`:
  - Dual source: `'mic'` | `'playback'`
  - `connectMic()` — requests permission, creates analyser
  - `connectPlayback(audioEl)` — connects `<audio>` element
  - Returns `{ volume, bass, mid, treble }` as refs
- [ ] **4.2** Add uniforms to Orb: `uAudioLevel`, `uBass`, `uMid`, `uTreble`
- [ ] **4.3** Map audio to visuals:
  - `displacementAmp = 0.05 + 0.3 * uAudioLevel`
  - `noiseSpeed = 0.5 + 2.0 * uBass`
  - `glowIntensity = 1.0 + 1.5 * uTreble`
  - Internal sparkle activity ↑ with audio
- [ ] **4.4** Smooth/lerp in RAF loop to prevent jitter
- [ ] **4.5** Leva controls for testing audio mappings

**Verification**: Speak into mic → orb pulses and sparkles intensify.

---

### Phase 5: Velocity Field (Fluid or Curl-Noise)
**Goal**: Cursor-reactive velocity field for particle advection.

> [!IMPORTANT]
> Implement CurlNoiseField first (5.0) as the guaranteed-mobile baseline, then FluidSim (5.1+) behind capability gate.

- [ ] **5.0** Create `src/lib/VelocityField.ts` — abstract interface:
  ```ts
  interface VelocityField {
    splat(uv: Vec2, force: Vec2, radius: number): void;
    step(dt: number): void;
    getTexture(): Texture | null; // null for analytic
  }
  ```
- [ ] **5.1** Implement `CurlNoiseField` (guaranteed mobile baseline):
  - Analytic curl noise function in GLSL
  - Cursor splat biases curl field locally (additive force term)
  - Returns null texture (particles sample analytically in shader)
- [ ] **5.2** Implement `FluidSim` (when `useFluidSim: true`):
  - FBO ping-pong for velocity/pressure
  - `splat.frag` — Gaussian force injection
  - `advect.frag` — semi-Lagrangian advection
  - `divergence.frag` + `pressure.frag` + `gradientSubtract.frag`
- [ ] **5.3** Factory: `createVelocityField(capabilities) → FluidSim | CurlNoiseField`

**Verification**:
- **Desktop (FluidSim)**: Debug overlay shows velocity field texture reacting to cursor
- **Mobile (CurlNoiseField)**: Cursor causes coherent swirl motion in particles (analytic field); optionally render debug vectors as lightweight overlay

---

### Phase 6: GPU Particle System (Halo)
**Goal**: 30k–200k particles advected by velocity field.

- [ ] **6.1** Create `src/lib/ParticleSystem.ts`:
  - Position FBO (ping-pong)
  - Particle count from quality tier
- [ ] **6.2** Create `src/shaders/sim/advect-particles.frag`:
  - Sample velocity (texture or analytic curl noise)
  - Update: `pos.xy += velocity * dt`
  - Bounds wrap/respawn
- [ ] **6.3** Implement `particles.vert`:
  - Sample position from FBO
  - Depth/perspective
- [ ] **6.4** Implement `particles.frag`:
  - Soft radial falloff
  - White/pink with subtle variance
  - Additive blend
- [ ] **6.5** Create `src/components/Particles.tsx`:
  - `<points>` with custom shader
  - Blending: additive

**Verification**: Particles visible, swirl around orb with cursor interaction.

---

### Phase 7: Unified Cursor Interaction
**Goal**: Single interaction field drives both sparkles and particles.

- [ ] **7.1** Create `src/hooks/usePointer.ts`:
  - Track `pointer`, `pointerVel` in normalized UV
  - Compute `cursorEnergy = clamp(length(pointerVel) * gain, 0, 1)`
- [ ] **7.2** Pass uniforms to both Orb and Particles
- [ ] **7.3** Tune cursor coupling:
  - **Internal sparkles**: lower coupling (subtle turbulence boost)
  - **Halo particles**: higher coupling (visible swirls)
- [ ] **7.4** Calmer behavior via:
  - Lower velocity magnitude
  - Higher smoothing (dampening)
  - Slower time scale

**Verification**: Moving cursor creates unified response in both layers.

---

### Phase 8: Performance Tuning
**Goal**: Validate 60fps desktop, 30+ fps mobile, no memory leaks.

> [!NOTE]
> This phase is tuning, not first-time performance consideration — constraints enforced in Phase 0.

- [ ] **8.1** Profile with Chrome DevTools Performance
- [ ] **8.2** Validate quality tier switching works correctly
- [ ] **8.3** Throttle fluid sim to 30fps if needed on mobile
- [ ] **8.4** Ensure resize/DPR changes don't cause render thrash
- [ ] **8.5** Check for GPU memory leaks (stable memory over time)
- [ ] **8.6** Test on real iOS Safari device

**Verification**: FPS counter stable, no "Long Task" warnings.

---

### Phase 9: Polish & Final Tuning
**Goal**: Match reference aesthetics exactly.

- [ ] **9.1** Fine-tune orb color gradient
- [ ] **9.2** Tune internal sparkle density/brightness
- [ ] **9.3** Tune particle color palette (coral/pink/white)
- [ ] **9.4** Add particle size variation based on velocity
- [ ] **9.5** Final Bloom parameters
- [ ] **9.6** Optional: subtle chromatic aberration

**Verification**: Visual comparison to reference — premium and alive.

---

## File Structure Summary

```
src/
├── shaders/
│   ├── lib/
│   │   ├── noise.glsl           # Simplex/Perlin 3D + curl noise
│   │   ├── common.glsl          # Shared uniforms & math (smin, fresnel)
│   │   └── sdf.glsl             # SDF primitives (sphere, roundedBox, etc.)
│   ├── sim/
│   │   ├── passthrough.vert     # Fullscreen quad vertex shader
│   │   ├── splat.frag           # Force injection (fluid sim)
│   │   ├── advect.frag          # Velocity advection
│   │   ├── divergence.frag      # Divergence compute
│   │   ├── pressure.frag        # Pressure solve
│   │   ├── gradientSubtract.frag
│   │   └── advect-particles.frag
│   ├── orb.vert                 # [DEPRECATED after 1.5] Mesh vertex shader
│   ├── orb.frag                 # [DEPRECATED after 1.5] Mesh fragment shader
│   ├── orb-sdf.frag             # Raymarched SDF orb + glassmorphic shading
│   ├── particles.vert           # FBO position sampling
│   └── particles.frag           # Soft sprite
├── lib/
│   ├── capabilities.ts          # WebGL detection + quality tiers
│   ├── qualityStore.ts          # Zustand quality state
│   ├── shapeStore.ts            # Shape morphing state (currentShape, morphProgress)
│   ├── VelocityField.ts         # Abstract interface
│   ├── FluidSim.ts              # Full fluid simulation
│   ├── CurlNoiseField.ts        # Fallback velocity field
│   └── ParticleSystem.ts        # GPU particle manager
├── hooks/
│   ├── useAudio.ts              # Dual-source audio analyser
│   └── usePointer.ts            # Unified cursor tracking
└── components/
    ├── Orb.tsx                  # [DEPRECATED after 1.5] Mesh-based orb
    ├── SDFOrb.tsx               # Raymarched SDF orb (shape-morphing ready)
    ├── Particles.tsx            # GPU particle points
    └── Scene.tsx                # Composition root (was OrbCanvas)
```

---

## Estimated Effort

| Phase | Focus | Est. Hours |
|-------|-------|------------|
| 0 | Infrastructure + Mobile-First | 2-3 |
| 1 | Static Orb (Mesh Prototype) | 2-3 |
| **1.5** | **SDF Architecture Refactor** | **4-6** |
| 2 | SDF Surface Animation | 2 |
| 3 | Internal Sparkles (Volumetric) | 3-4 |
| 4 | Audio Integration | 3 |
| 5 | Velocity Field (Fluid + Curl) | 5-6 |
| 6 | GPU Particles | 4 |
| 7 | Unified Cursor | 2 |
| 8 | Performance Tuning | 2-3 |
| 9 | Polish | 2-3 |
| **Total** | | **31-39 hrs** |

---

## Future Phases (Post-MVP)

> These phases are documented for planning but not scheduled yet.

### Phase 10: Modal Transformations
**Goal**: Implement actual UI modals that the orb morphs into.

- [ ] Define modal shapes in `sdf.glsl` (calendar grid, settings panel, chat bubble)
- [ ] Create `<Modal>` wrapper component that triggers morph
- [ ] Implement content rendering inside morphed shape
- [ ] Handle interaction state (orb mode vs modal mode)

### Phase 11: Particle-to-Element Transitions (Stretch Goal)
**Goal**: Particles animate to become UI elements on the modal.

- [ ] Particle target position system
- [ ] GSAP animation from scattered → grid positions
- [ ] Opacity/scale transitions as particles become icons
- [ ] Reverse animation when modal closes

---

*Phase 0 complete. Phase 1 in progress. Phase 1.5 (SDF refactor) is next critical milestone.*
