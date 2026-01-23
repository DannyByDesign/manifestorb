# Phase 2: SDF Surface Animation — Atomic Checklist

> **Goal**: Organic procedural surface animation via SDF perturbation — making the orb undulate like a living, breathing blob.
>
> **Prerequisite**: Phase 1 complete (SDF raymarched orb with glassmorphic shading)

Each checkbox is a **single, one-dimensional problem**. Solve them in order.

---

## 2.1 — Noise Library Integration

> Upgrade from basic `noise3D()` to high-quality simplex noise from `noise.glsl`.

### 2.1.1 Verify noise.glsl exists and is complete
- [x] Confirm `src/shaders/lib/noise.glsl` exists
- [x] Confirm `snoise(vec3)` function is implemented (returns -1 to 1)
- [x] Confirm `snoise01(vec3)` function is implemented (returns 0 to 1)
- [x] Confirm `fbm3(vec3, int octaves)` function is implemented
- [x] Confirm `curlNoise(vec3)` function is implemented

### 2.1.2 Import noise.glsl into orb.frag
- [x] Add `#include` or copy noise functions into `orb.frag` (depending on build setup)
- [x] If copying: Add `snoise(vec3)` function after constants section
- [x] If copying: Add `fbm3(vec3, int)` function after `snoise`
- [x] If copying: Add `curlNoise(vec3)` function after `fbm3`
- [x] Remove or comment out the old `noise3D()` function
- [x] Remove or comment out the old `hash33()` function (if only used by noise3D)

### 2.1.3 Verify noise import compiles
- [x] Run `bun run build` to verify no shader compilation errors
- [ ] Check browser console for WebGL shader errors

---

## 2.2 — Surface Displacement System

> Upgrade the SDF perturbation to use better noise with configurable parameters.

### 2.2.1 Review current displacement implementation
- [x] Locate `sceneSDF()` function in `orb.frag`
- [x] Identify the current noise displacement code block
- [x] Note the current uniforms used: `uSurfaceNoise`, `uNoiseScale`, `uNoiseSpeed`

### 2.2.2 Add new displacement uniforms
- [x] Add `uniform float uDisplacementAmp;` — overall displacement strength (0.0-0.2)
- [x] Add `uniform int uNoiseOctaves;` — FBM octave count (1-4)
- [x] Add `uniform float uNoiseFrequency;` — base frequency multiplier (1.0-5.0)
- [x] Add `uniform float uNoiseLacunarity;` — frequency multiplier per octave (1.5-2.5)
- [x] Add `uniform float uNoisePersistence;` — amplitude decay per octave (0.3-0.7)

### 2.2.3 Implement improved displacement in sceneSDF()
- [x] Replace `noise3D()` call with `snoise()` call
- [x] Calculate animated noise position: `vec3 noiseP = p * uNoiseFrequency + uTime * uNoiseSpeed;`
- [x] Implement single-octave displacement: `float disp = snoise(noiseP) * uDisplacementAmp;`
- [x] Add displacement to SDF: `d += disp;`

### 2.2.4 Implement FBM multi-octave displacement (optional detail)
- [x] Create helper function `float surfaceDisplacement(vec3 p)`
- [x] Inside helper: Initialize `float value = 0.0;`
- [x] Inside helper: Initialize `float amplitude = 1.0;`
- [x] Inside helper: Initialize `float frequency = uNoiseFrequency;`
- [x] Inside helper: Loop `uNoiseOctaves` times (use constant max, check against uniform)
- [x] Inside loop: Accumulate `value += amplitude * snoise(p * frequency + uTime * uNoiseSpeed);`
- [x] Inside loop: Update `frequency *= uNoiseLacunarity;`
- [x] Inside loop: Update `amplitude *= uNoisePersistence;`
- [x] Return `value * uDisplacementAmp;`
- [x] Call `surfaceDisplacement(p)` in `sceneSDF()` instead of inline noise

### 2.2.5 Verify displacement compiles and renders
- [x] Run `bun run build`
- [ ] Check browser — orb should still render
- [ ] Verify no visual artifacts or NaN issues

---

## 2.3 — Flow-Based Animation

> Add curl noise for organic, fluid-like surface movement.

### 2.3.1 Add flow animation uniforms
- [x] Add `uniform float uFlowStrength;` — how much curl noise affects position (0.0-0.5)
- [x] Add `uniform float uFlowSpeed;` — animation speed of flow field (0.1-1.0)
- [x] Add `uniform float uFlowScale;` — spatial scale of flow field (0.5-3.0)

### 2.3.2 Implement flow-based position offset
- [x] In `surfaceDisplacement()` or `sceneSDF()`:
- [x] Calculate flow position: `vec3 flowP = p * uFlowScale + uTime * uFlowSpeed;`
- [x] Sample curl noise: `vec3 flow = curlNoise(flowP);`
- [x] Create offset position: `vec3 offsetP = p + flow * uFlowStrength;`
- [x] Use `offsetP` instead of `p` for noise sampling

### 2.3.3 Test flow animation visually
- [ ] Run dev server
- [ ] Observe surface movement — should have smooth, swirling motion
- [ ] Verify no discontinuities or popping

### 2.3.4 Tune flow parameters for organic feel
- [ ] Adjust `uFlowStrength` for subtle vs dramatic movement
- [ ] Adjust `uFlowSpeed` for calm vs energetic animation
- [ ] Adjust `uFlowScale` for fine vs coarse flow patterns

---

## 2.4 — Audio-Reactive Prep

> Add uniforms and mapping logic for future audio integration (Phase 4).

### 2.4.1 Add audio-reactive uniforms to shader
- [x] Add `uniform float uAudioLevel;` — overall audio amplitude (0.0-1.0)
- [x] Add `uniform float uAudioBass;` — low frequency band (0.0-1.0)
- [x] Add `uniform float uAudioMid;` — mid frequency band (0.0-1.0)
- [x] Add `uniform float uAudioTreble;` — high frequency band (0.0-1.0)

### 2.4.2 Map audio to displacement amplitude
- [x] Create `float audioDisplacementMod()` function
- [x] Inside: Calculate base modifier: `float mod = 1.0;`
- [x] Inside: Add audio influence: `mod += uAudioLevel * 2.0;` (audio doubles displacement)
- [x] Inside: Add bass punch: `mod += uAudioBass * 1.5;` (bass adds extra punch)
- [x] Inside: Return `mod;`
- [x] Multiply final displacement by `audioDisplacementMod()`

### 2.4.3 Map audio to flow speed
- [x] In flow calculation, modify speed: `float dynamicFlowSpeed = uFlowSpeed * (1.0 + uAudioMid);`
- [x] Use `dynamicFlowSpeed` instead of `uFlowSpeed` in flow position calculation

### 2.4.4 Map audio to noise frequency (treble = more detail)
- [x] In noise calculation, modify frequency: `float dynamicFreq = uNoiseFrequency * (1.0 + uAudioTreble * 0.5);`
- [x] Use `dynamicFreq` for noise sampling

### 2.4.5 Add audio uniforms to Orb.tsx
- [x] Add `uAudioLevel: 0` to shader material uniforms
- [x] Add `uAudioBass: 0` to shader material uniforms
- [x] Add `uAudioMid: 0` to shader material uniforms
- [x] Add `uAudioTreble: 0` to shader material uniforms

### 2.4.6 Add placeholder audio sync in useFrame
- [x] Add comment: `// Audio uniforms - will be connected in Phase 4`
- [x] Add: `if (u.uAudioLevel) u.uAudioLevel.value = 0; // TODO: connect useAudio hook`
- [x] Add: `if (u.uAudioBass) u.uAudioBass.value = 0;`
- [x] Add: `if (u.uAudioMid) u.uAudioMid.value = 0;`
- [x] Add: `if (u.uAudioTreble) u.uAudioTreble.value = 0;`

### 2.4.7 Verify audio uniforms don't break rendering
- [x] Run `bun run build`
- [ ] Verify orb renders normally (audio values are 0)
- [ ] Verify no shader compilation errors

---

## 2.5 — Shape Morph Compatibility

> Ensure surface animation works correctly across all shape types.

### 2.5.1 Test displacement on sphere (shapeType = 0)
- [ ] Set `uShapeType = 0` via Leva
- [ ] Verify displacement animates smoothly
- [ ] Verify no visual artifacts at poles

### 2.5.2 Test displacement on rounded box (shapeType = 1)
- [ ] Set `uShapeType = 1` via Leva
- [ ] Set `uMorphProgress = 1.0` to fully show box
- [ ] Verify displacement works on flat faces
- [ ] Verify displacement works on rounded corners
- [ ] Verify no sharp discontinuities

### 2.5.3 Test displacement on capsule (shapeType = 2)
- [ ] Set `uShapeType = 2` via Leva
- [ ] Set `uMorphProgress = 1.0` to fully show capsule
- [ ] Verify displacement works on cylindrical body
- [ ] Verify displacement works on hemispherical caps

### 2.5.4 Test displacement during morph transition
- [ ] Set `uShapeType = 1` (rounded box)
- [ ] Animate `uMorphProgress` from 0 to 1 slowly
- [ ] Verify displacement remains smooth during transition
- [ ] Verify no popping or discontinuities at any morph stage

### 2.5.5 Adjust displacement if needed for different shapes
- [ ] If box corners look bad: Consider scaling displacement by curvature
- [ ] If capsule ends look bad: Consider adjusting noise orientation
- [ ] Document any shape-specific adjustments in code comments

---

## 2.6 — Leva Debug Controls

> Add comprehensive controls for real-time parameter tuning.

### 2.6.1 Reorganize Surface folder in Leva controls
- [x] Rename existing Surface folder to "Animation" or keep as is
- [x] Group related controls together

### 2.6.2 Add displacement controls
- [x] Add `displacementAmp` slider: `{ value: 0.08, min: 0, max: 0.25, step: 0.005, label: "Displacement" }`
- [x] Add `noiseOctaves` slider: `{ value: 2, min: 1, max: 4, step: 1, label: "Octaves" }`
- [x] Add `noiseFrequency` slider: `{ value: 2.0, min: 0.5, max: 6.0, step: 0.1, label: "Frequency" }`

### 2.6.3 Add flow controls
- [x] Add `flowStrength` slider: `{ value: 0.15, min: 0, max: 0.5, step: 0.01, label: "Flow Strength" }`
- [x] Add `flowSpeed` slider: `{ value: 0.3, min: 0, max: 1.0, step: 0.05, label: "Flow Speed" }`
- [x] Add `flowScale` slider: `{ value: 1.5, min: 0.5, max: 4.0, step: 0.1, label: "Flow Scale" }`

### 2.6.4 Add animation timing controls
- [x] Add `noiseSpeed` slider (if not already present): `{ value: 0.2, min: 0, max: 1.0, step: 0.05, label: "Noise Speed" }`
- [x] Add `lacunarity` slider: `{ value: 2.0, min: 1.5, max: 2.5, step: 0.1, label: "Lacunarity" }`
- [x] Add `persistence` slider: `{ value: 0.5, min: 0.3, max: 0.7, step: 0.05, label: "Persistence" }`

### 2.6.5 Add audio simulation controls (for testing without audio)
- [x] Create new "Audio (Test)" folder in Leva
- [x] Add `testAudioLevel` slider: `{ value: 0, min: 0, max: 1, step: 0.05, label: "Level" }`
- [x] Add `testAudioBass` slider: `{ value: 0, min: 0, max: 1, step: 0.05, label: "Bass" }`
- [x] Add `testAudioMid` slider: `{ value: 0, min: 0, max: 1, step: 0.05, label: "Mid" }`
- [x] Add `testAudioTreble` slider: `{ value: 0, min: 0, max: 1, step: 0.05, label: "Treble" }`
- [x] Connect test values to audio uniforms in useFrame

### 2.6.6 Sync all new controls to uniforms in useFrame
- [x] Add: `if (u.uDisplacementAmp) u.uDisplacementAmp.value = controls.displacementAmp;`
- [x] Add: `if (u.uNoiseOctaves) u.uNoiseOctaves.value = controls.noiseOctaves;`
- [x] Add: `if (u.uNoiseFrequency) u.uNoiseFrequency.value = controls.noiseFrequency;`
- [x] Add: `if (u.uFlowStrength) u.uFlowStrength.value = controls.flowStrength;`
- [x] Add: `if (u.uFlowSpeed) u.uFlowSpeed.value = controls.flowSpeed;`
- [x] Add: `if (u.uFlowScale) u.uFlowScale.value = controls.flowScale;`
- [x] Add: `if (u.uNoiseLacunarity) u.uNoiseLacunarity.value = controls.lacunarity;`
- [x] Add: `if (u.uNoisePersistence) u.uNoisePersistence.value = controls.persistence;`
- [x] Update audio test values to uniforms

---

## 2.7 — Mobile Optimization

> Ensure surface animation performs well on mobile devices.

### 2.7.1 Add quality-tier aware noise octaves
- [x] In `useFrame`, get tier: `const isMobile = tier.tierName === "mobile";`
- [x] Set octaves based on tier: `const maxOctaves = isMobile ? 2 : controls.noiseOctaves;`
- [x] Pass clamped octaves to shader: `u.uNoiseOctaves.value = maxOctaves;`

### 2.7.2 Add quality-tier aware flow calculation
- [x] Consider disabling curl noise on very low-end devices
- [x] Add uniform `uniform int uEnableFlow;` (0 = disabled, 1 = enabled)
- [x] In shader: `if (uEnableFlow > 0) { /* apply flow */ }`
- [x] In Orb.tsx: Set `uEnableFlow` based on tier (mobile could be 0 or 1 depending on testing)

### 2.7.3 Simplify noise on mobile (if needed)
- [x] If FBM is too expensive: Use single octave on mobile
- [x] If curl noise is too expensive: Skip flow offset on mobile
- [x] Add shader branch: `#ifdef MOBILE_QUALITY` or use uniform

### 2.7.4 Test on mobile viewport size
- [ ] Use Chrome DevTools device emulation
- [ ] Set to iPhone 12/13/14 Pro viewport
- [ ] Verify animation is smooth (not janky)
- [ ] Check for frame drops in Performance tab

### 2.7.5 Document mobile fallbacks in code
- [x] Add comments explaining any mobile-specific code paths
- [ ] Document expected performance characteristics

---

## 2.8 — Verification

> Final checks to confirm Phase 2 is complete.

### 2.8.1 Visual verification — organic blob feel
- [ ] Orb surface undulates smoothly
- [ ] Movement feels organic, not mechanical
- [ ] No harsh edges or discontinuities
- [ ] Animation speed feels calm and natural

### 2.8.2 Visual verification — flow animation
- [ ] Surface has subtle swirling/flowing motion
- [ ] Flow is not too fast or too slow
- [ ] Flow enhances organic feel without being distracting

### 2.8.3 Visual verification — shape morph compatibility
- [ ] Displacement works on sphere
- [ ] Displacement works on rounded box
- [ ] Displacement works on capsule
- [ ] Displacement works during morph transitions

### 2.8.4 Audio-reactive prep verification
- [ ] Test audio sliders in Leva affect displacement
- [ ] Higher "Level" = more displacement
- [ ] Higher "Bass" = more punch/movement
- [ ] Higher "Treble" = more detail/frequency
- [ ] Audio uniforms ready for Phase 4 connection

### 2.8.5 Performance verification — desktop
- [ ] Open Chrome DevTools Performance tab
- [ ] Record 5 seconds of animation
- [ ] Verify consistent 60fps
- [ ] No long frames or jank

### 2.8.6 Performance verification — mobile
- [ ] Use device emulation or real device
- [ ] Verify 30+ fps with animation
- [ ] No visible stuttering
- [ ] Quality tier fallbacks working

### 2.8.7 Code quality verification
- [ ] Run `bun run build` — no errors
- [ ] No TypeScript errors
- [ ] No console errors in browser
- [ ] Code is commented where non-obvious

---

## Summary

### Files Modified

| File | Changes |
|------|---------|
| `src/shaders/orb.frag` | Import simplex/curl noise, FBM displacement, flow animation, audio uniforms |
| `src/components/Orb.tsx` | New uniforms, Leva controls, audio prep, mobile optimization |

### New Uniforms Added

| Uniform | Type | Range | Purpose |
|---------|------|-------|---------|
| `uDisplacementAmp` | float | 0-0.25 | Overall displacement strength |
| `uNoiseOctaves` | int | 1-4 | FBM detail level |
| `uNoiseFrequency` | float | 0.5-6.0 | Base noise frequency |
| `uNoiseLacunarity` | float | 1.5-2.5 | Frequency multiplier per octave |
| `uNoisePersistence` | float | 0.3-0.7 | Amplitude decay per octave |
| `uFlowStrength` | float | 0-0.5 | Curl noise influence |
| `uFlowSpeed` | float | 0-1.0 | Flow animation speed |
| `uFlowScale` | float | 0.5-4.0 | Flow spatial scale |
| `uAudioLevel` | float | 0-1 | Audio amplitude (Phase 4) |
| `uAudioBass` | float | 0-1 | Low frequency (Phase 4) |
| `uAudioMid` | float | 0-1 | Mid frequency (Phase 4) |
| `uAudioTreble` | float | 0-1 | High frequency (Phase 4) |
| `uEnableFlow` | int | 0-1 | Flow toggle for mobile |

### Recommended Default Values

```typescript
// Calm, organic defaults
displacementAmp: 0.06,
noiseOctaves: 2,
noiseFrequency: 2.0,
noiseSpeed: 0.15,
lacunarity: 2.0,
persistence: 0.5,
flowStrength: 0.1,
flowSpeed: 0.2,
flowScale: 1.5,
```

### Success Criteria

- [ ] Orb surface undulates like a living blob
- [ ] Flow animation creates organic swirling motion
- [ ] Works on all shapes (sphere, box, capsule)
- [ ] Works during shape morph transitions
- [ ] Audio test sliders affect animation
- [ ] 60fps on desktop, 30+ fps on mobile
- [ ] Build passes with no errors

---

## Dependency Graph

```
2.1 Noise Library Integration
         │
         ▼
2.2 Surface Displacement System
         │
         ▼
2.3 Flow-Based Animation
         │
         ├──────────────────────┐
         ▼                      ▼
2.4 Audio-Reactive Prep    2.5 Shape Morph Compat
         │                      │
         └──────────┬───────────┘
                    ▼
         2.6 Leva Debug Controls
                    │
                    ▼
         2.7 Mobile Optimization
                    │
                    ▼
              2.8 Verification
```

