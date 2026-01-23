# Audio-Reactive Orb Implementation Plan

## Reference Target

![Reference orb visualization](file:///Users/dannywang/.gemini/antigravity/brain/ad9afe38-88b8-4a1f-b9b3-71f88d37c147/uploaded_image_1769133940834.png)

> **Target**: Light pink hue orb with glowing particle halo, audio-reactive displacement, and cursor-driven fluid particle motion.

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
| Orb | WebGL shader | Light pink base, near-white fresnel rim, warm/pale core |
| Particles | WebGL points | White/pink, additive blend, subtle variance |

### Audio Source Design

```
useAudio hook
├── source: 'mic' | 'playback'
├── connectMic() → MediaStream analyser
└── connectPlayback(audioEl) → AudioElement analyser
                                 ↑
                        (ElevenLabs TTS later)
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

### Phase 1: Static Orb Rendering
**Goal**: Beautiful pink orb with fresnel rim and soft gradient.

- [ ] **1.1** Implement `orb.vert` — passthrough with normals, UV, view direction
- [ ] **1.2** Implement `orb.frag`:
  - Base: light pink HSL(340, 70%, 85%)
  - Rim: near-white pink fresnel
  - Core: slightly warmer/paler pink
- [ ] **1.3** Create `src/components/Orb.tsx` with `shaderMaterial`
  - Uniforms: `uTime`, `uResolution`, `uPointer`, `uPointerVel`, `uCursorEnergy`
- [ ] **1.4** Replace placeholder in `OrbCanvas.tsx` with `<Orb />`
- [ ] **1.5** Tune Bloom for soft ethereal glow

**Verification**: Pink orb renders centered with glowing rim.

---

### Phase 2: Vertex Displacement (Noise)
**Goal**: Organic procedural surface animation.

- [ ] **2.1** Integrate noise.glsl into `orb.vert`
- [ ] **2.2** Add uniforms: `uNoiseScale`, `uNoiseSpeed`, `uDisplacementAmp`
- [ ] **2.3** Displace vertices along normal using 3D noise
- [ ] **2.4** Add time-based animation

**Verification**: Orb surface undulates gently like an organic blob.

---

### Phase 3: Internal Sparkles (Shader-Based)
**Goal**: Volume-contained glitter inside orb, cursor-reactive.

- [ ] **3.1** In `orb.frag`, add internal sparkle pass:
  - Treat orb as sphere with view ray intersection
  - Generate sparkle points via 3D noise hash in object space
  - Volume-mask to sphere radius
- [ ] **3.2** Animate sparkles with smooth flow:
  ```glsl
  p = p + flow(p, uTime) * k
  ```
- [ ] **3.3** React to cursor via `uCursorEnergy`:
  - Bias internal flow field toward cursor-facing region
  - OR add cursor-driven turbulence scalar
- [ ] **3.4** Tune sparkle density, brightness, animation speed

**Verification**: Sparkles visible inside orb, intensify when cursor nearby.

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
│   │   ├── noise.glsl           # Simplex/Perlin 3D
│   │   └── common.glsl          # Shared uniforms
│   ├── sim/
│   │   ├── passthrough.vert     # Fullscreen quad
│   │   ├── splat.frag           # Force injection
│   │   ├── advect.frag          # Velocity advection
│   │   ├── divergence.frag      # Divergence compute
│   │   ├── pressure.frag        # Pressure solve
│   │   ├── gradientSubtract.frag
│   │   └── advect-particles.frag
│   ├── orb.vert                 # Vertex displacement
│   ├── orb.frag                 # Fresnel + internal sparkles
│   ├── particles.vert           # FBO position sampling
│   └── particles.frag           # Soft sprite
├── lib/
│   ├── capabilities.ts          # WebGL detection + quality tiers
│   ├── qualityStore.ts          # Zustand quality state
│   ├── VelocityField.ts         # Abstract interface
│   ├── FluidSim.ts              # Full fluid simulation
│   ├── CurlNoiseField.ts        # Fallback velocity field
│   └── ParticleSystem.ts        # GPU particle manager
├── hooks/
│   ├── useAudio.ts              # Dual-source audio analyser
│   └── usePointer.ts            # Unified cursor tracking
└── components/
    ├── Orb.tsx                  # Custom shader orb
    ├── Particles.tsx            # GPU particle points
    └── OrbCanvas.tsx            # Composition root
```

---

## Estimated Effort

| Phase | Focus | Est. Hours |
|-------|-------|------------|
| 0 | Infrastructure + Mobile-First | 2-3 |
| 1 | Static Orb | 2-3 |
| 2 | Vertex Displacement | 2 |
| 3 | Internal Sparkles | 3-4 |
| 4 | Audio Integration | 3 |
| 5 | Velocity Field (Fluid + Curl) | 5-6 |
| 6 | GPU Particles | 4 |
| 7 | Unified Cursor | 2 |
| 8 | Performance Tuning | 2-3 |
| 9 | Polish | 2-3 |
| **Total** | | **27-33 hrs** |

---

*Ready to implement Phase 0 when approved!*
