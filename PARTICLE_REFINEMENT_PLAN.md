# "Blueyard Look" Particle System — Last-Mile Refinement Plan

> **Single Source of Truth**
>
> Goal: Make the orb feel **Houdini-prebaked / filmic**, not "procedural math."  
> Key outcomes: **layered particle character (dust/body/glints), coherent flow-field motion, shell + halo structure, selective bloom, sprite-based particles, and subtle film grain/dither.**

**Reference:** https://blueyard.com/ (Unseen Studio - Houdini-prebaked, 30k+ particles)  
**Our Project:** https://amodel-azure.vercel.app/

---

## 0) Non-Negotiables (Baseline Constraints)

1. **No visible debug UI in production.**  
   - Leva panels must be gated behind `process.env.NODE_ENV === "development"`.

2. **Everything reads in layers**:
   - **Dust** (sub-pixel haze), **Body** (volume fill), **Glints** (rare, bloom-triggering sparks), **Halo** (outside silhouette).

3. **Motion must be flow-field coherent**:
   - Avoid "stacked forces everywhere." Use **a single dominant flow field** + mild perturbations.

4. **Particles must not be just circles**:
   - Use **sprites (bokeh / grain / glint)** with rotation, aspect variation, and dithering.

---

## 1) Priority Summary (What Actually Gets You to Blueyard)

| Priority | Feature | Why it matters | Complexity |
|---:|---|---|---|
| **P0** | **Flow-field advection (coherent swirl)** | The "alive" feeling is motion coherence | High |
| **P0** | **Sprite-based particles (3 textures)** | Instantly removes "gamey point circles" | Medium |
| **P0** | **Layered system (Dust/Body/Glints/Halo)** | Depth + polish + cinematic hierarchy | Medium |
| P1 | Selective bloom & tone mapping | "Glowing dust" without washout | Medium |
| P1 | Shell density + outer halo | Blueyard silhouette reads expensive | Medium |
| P2 | Pauses/hover states | Adds micro-life | Medium |
| P2 | Hero streams (prefer as flow influences) | Adds choreographed structure subtly | High |

---

## 2) Implementation Order (Fastest Path to "Last Mile")

**Recommended order:**  
**A → B → C → D → E → F → G → H**

| Phase | Name | Est. Time | Files to Modify |
|-------|------|-----------|-----------------|
| A | Production gating + render settings | 1 hour | `Sparkles.tsx`, `Orb.tsx`, `Scene.tsx` |
| B | Sprite particle rendering | 2-4 hours | `Sparkles.tsx`, `sparkles.vert`, `sparkles.frag`, `public/textures/*` |
| C | Layer definitions | 1-2 hours | `Sparkles.tsx`, `sparkles.vert`, `sparkles.frag` |
| D | Spawn distribution + halo | 2-4 hours | `particleCompute.ts`, `particleSimPosition.frag`, **NEW:** `HaloDust.tsx` |
| **E** | **Flow-field advection (CRITICAL)** | **4-8 hours** | `particleCompute.ts`, `particleSimVelocity.frag` |
| F | Selective bloom + tone mapping | 2-4 hours | **NEW:** `Effects.tsx`, `sparkles.frag` |
| G | Micro behaviors | 2-4 hours | `particleSimVelocity.frag`, `sparkles.frag` |
| H | Hero curves as flow injectors | 3-5 hours | **NEW:** `heroStreams.ts`, `particleSimVelocity.frag` |

---

## File Change Map (Complete Reference)

### Files to Create (NEW)
| File | Phase | Purpose |
|------|-------|---------|
| `public/textures/sprite_dust.png` | B | Grainy soft micro speck texture |
| `public/textures/sprite_bokeh.png` | B | Soft disc with gentle falloff |
| `public/textures/sprite_glint.png` | B | Sharp bright core, star-ish falloff |
| `src/components/HaloDust.tsx` | D | Separate halo particle system outside orb |
| `src/components/Effects.tsx` | F | Bloom + tone mapping post-processing |
| `src/lib/heroStreams.ts` | H | Hero curve definitions + baking utilities |

### Files to Modify (EXISTING)
| File | Phases | Changes |
|------|--------|---------|
| `src/components/Sparkles.tsx` | A, B, C | Leva gating, new attributes (layer/sprite/rot/aspect/twinkle), texture uniforms |
| `src/components/Orb.tsx` | A | Leva gating |
| `src/components/Scene.tsx` | A, D, F | Renderer settings, add HaloDust, add Effects |
| `src/shaders/sparkles.vert` | B, C | Pass new varyings, layer-based size/brightness/follow |
| `src/shaders/sparkles.frag` | B, C, F, G | Sprite sampling, rotation, dither, layer-based twinkle |
| `src/lib/particleCompute.ts` | D, E, H | Shell PDF uniforms, flow field uniforms, vortex animation |
| `src/shaders/particleSimPosition.frag` | D | Shell PDF + cluster noise spawn logic |
| `src/shaders/particleSimVelocity.frag` | E, G, H | **COMPLETE REWRITE**: flow field advection, pause states, hero curve injection |

---

## A) Production Gating + Render Settings (1 hour)

### Files to Modify
- `src/components/Sparkles.tsx`
- `src/components/Orb.tsx`
- `src/components/Scene.tsx`

### A1) Gate Leva UI (No debug panel in prod)
**File:** `src/components/Sparkles.tsx` (and any other Leva usage)

```typescript
const isDev = process.env.NODE_ENV === "development";

// Define defaults for production
const DEFAULTS = {
  enabled: true,
  baseColor: "#a855f7",
  glowColor: "#e9d5ff",
  // ... other defaults
};

// Only call useControls in dev, otherwise provide defaults:
const controls = isDev 
  ? useControls({ /* ... full config ... */ }) 
  : DEFAULTS;
```

### A2) Set renderer to filmic defaults
**File:** `src/components/Scene.tsx`

```tsx
<Canvas
  dpr={[1, 2]} // or dynamic tier-based DPR
  gl={{ 
    antialias: true, 
    alpha: true, 
    powerPreference: "high-performance",
    // If not using postprocessing ToneMapping:
    // toneMapping: THREE.ACESFilmicToneMapping,
    // toneMappingExposure: 1.0,
  }}
  camera={{ position: [0, 0, 3], fov: 45 }}
>
```

---

## B) Particle Rendering: Sprites + Rotation + Dither (P0) (2-4 hours)

### Files to Modify
- `src/components/Sparkles.tsx` — Add attributes, load textures
- `src/shaders/sparkles.vert` — Pass new varyings
- `src/shaders/sparkles.frag` — Sprite sampling, rotation, dither

### Files to Create
- `public/textures/sprite_dust.png`
- `public/textures/sprite_bokeh.png`
- `public/textures/sprite_glint.png`

Replace "perfect circles" with sprite-driven character.

### B1) Add 3 textures (or an atlas)

**Textures needed** (small PNGs, alpha channel):
- `sprite_dust.png` — grainy soft micro speck
- `sprite_bokeh.png` — soft disc with gentle falloff
- `sprite_glint.png` — sharper bright core with subtle star-ish falloff

**Location:** `public/textures/`

### B2) Add per-particle render attributes
**File:** `src/components/Sparkles.tsx`

Add attributes:
```typescript
// Layer assignment (affects all other properties)
const layers = useMemo(() => {
  const arr = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    const roll = Math.random();
    if (roll < 0.45) {
      arr[i] = 0.0; // Dust (45%)
    } else if (roll < 0.93) {
      arr[i] = 1.0; // Body (48%)
    } else {
      arr[i] = 2.0; // Glint (5%)
    }
  }
  return arr;
}, [particleCount]);

// Sprite index (maps directly from layer for now)
const sprites = useMemo(() => {
  const arr = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    arr[i] = layers[i]; // 0=dust, 1=bokeh, 2=glint
  }
  return arr;
}, [particleCount, layers]);

// Rotation (0..2π)
const rotations = useMemo(() => {
  const arr = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    arr[i] = Math.random() * Math.PI * 2;
  }
  return arr;
}, [particleCount]);

// Aspect ratio (0.6..1.4) for subtle ellipse
const aspects = useMemo(() => {
  const arr = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    arr[i] = 0.6 + Math.random() * 0.8;
  }
  return arr;
}, [particleCount]);

// Twinkle seed for flicker timing
const twinkles = useMemo(() => {
  const arr = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    arr[i] = Math.random();
  }
  return arr;
}, [particleCount]);
```

Add to geometry:
```typescript
geo.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));
geo.setAttribute("aSprite", new THREE.BufferAttribute(sprites, 1));
geo.setAttribute("aRot", new THREE.BufferAttribute(rotations, 1));
geo.setAttribute("aAspect", new THREE.BufferAttribute(aspects, 1));
geo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));
```

### B3) Fragment shader uses sprite sampling
**File:** `src/shaders/sparkles.frag`

```glsl
// Add uniforms
uniform sampler2D uSpriteDust;
uniform sampler2D uSpriteBokeh;
uniform sampler2D uSpriteGlint;

// Varyings from vertex shader
varying float vSprite;
varying float vRot;
varying float vAspect;

// Rotate 2D point
vec2 rot2(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  // Transform UV with rotation and aspect
  vec2 uv = gl_PointCoord - 0.5;
  uv.x *= vAspect;              // subtle ellipse
  uv = rot2(uv, vRot);          // rotate
  vec2 suv = uv + 0.5;          // back to 0..1
  
  // Bounds check (discard if rotated UV is outside)
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
    discard;
  }
  
  // Sprite select based on layer
  vec4 tex;
  if (vSprite < 0.5) {
    tex = texture2D(uSpriteDust, suv);
  } else if (vSprite < 1.5) {
    tex = texture2D(uSpriteBokeh, suv);
  } else {
    tex = texture2D(uSpriteGlint, suv);
  }
  
  // Apply color and alpha...
  // (rest of existing color logic)
}
```

### B4) Dithering / grain (subtle filmic lift)
Add tiny noise-based dither to break banding:

```glsl
// Hash function for dither
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// In main(), before final output:
float dither = (hash12(gl_FragCoord.xy + uTime * 0.1) - 0.5) * 0.03;
alpha = clamp(alpha + dither, 0.0, 1.0);
```

**Result:** Particles stop looking like uniform discs.

---

## C) Layered System Definitions (P0) (1-2 hours)

### Files to Modify
- `src/components/Sparkles.tsx` — Layer distribution logic
- `src/shaders/sparkles.vert` — Layer-based size/brightness/follow functions
- `src/shaders/sparkles.frag` — Layer-based color/twinkle

One GPU sim, but render behavior reads as distinct layers.

### C1) Layer distribution + role

| Layer | % | Size | Brightness | Speed bias | Bloom? | Role |
|-------|---|------|------------|------------|--------|------|
| **Dust** | 45% | 0.25–1.2 px | very dim | slow | No | haze/depth |
| **Body** | 48% | 1.2–6 px | mid | medium | Rare | volume |
| **Glints** | 5% | 4–14 px | bright | fast bursts | Yes | sparkle accents |
| **Halo** | ~2k pts | 0.5–3 px | mid | slow spin | Very subtle | silhouette polish |

> Note: "Hero 12–20px" is okay, but keep very rare and use glint sprite, not bokeh.

### C2) Correlate size ↔ brightness ↔ sprite in vertex shader
**File:** `src/shaders/sparkles.vert`

```glsl
// Layer-based property lookup
float getLayerSize(float layer, float seed) {
  if (layer < 0.5) {
    // Dust: 0.25 - 1.2
    return 0.25 + seed * 0.95;
  } else if (layer < 1.5) {
    // Body: 1.2 - 6.0
    return 1.2 + seed * 4.8;
  } else {
    // Glint: 4.0 - 14.0
    return 4.0 + seed * 10.0;
  }
}

float getLayerBrightness(float layer, float seed) {
  if (layer < 0.5) {
    // Dust: very dim (0.15 - 0.4)
    return 0.15 + seed * 0.25;
  } else if (layer < 1.5) {
    // Body: mid (0.4 - 0.85)
    return 0.4 + seed * 0.45;
  } else {
    // Glint: bright HDR (1.2 - 2.2) - triggers bloom
    return 1.2 + seed * 1.0;
  }
}

float getLayerFollowStrength(float layer) {
  if (layer < 0.5) {
    return 0.22; // Dust: high follow (feels suspended)
  } else if (layer < 1.5) {
    return 0.12; // Body: medium follow
  } else {
    return 0.06; // Glint: low follow (streaks with momentum)
  }
}
```

---

## D) Spawn Distribution: Shell + Clusters + Halo (P1) (2-4 hours)

### Files to Modify
- `src/lib/particleCompute.ts` — Add density uniforms, animate density offset
- `src/shaders/particleSimPosition.frag` — Shell PDF + cluster noise spawn logic

### Files to Create
- `src/components/HaloDust.tsx` — Separate halo particle system

### D1) Replace uniform sphere spawn with shell + cluster sampling

**Target spatial structure:**
- Core density (soft)
- Mid shell density peak (where the "volume" reads)
- Sparse outer interior (helps define orb boundary)
- Outside halo layer (separate)

#### D1.1) Radial shell PDF
**File:** `src/shaders/particleSimPosition.frag`

```glsl
// Shell probability distribution function
// Peak around r ≈ 0.65–0.85 of orb radius with some core presence
float shellPDF(float r) {
  // r in 0..1
  float shell = exp(-pow((r - 0.75) / 0.18, 2.0));
  float core = 0.35 * exp(-pow(r / 0.35, 2.0));
  return clamp(core + shell, 0.05, 1.0);
}
```

#### D1.2) Cluster noise (low frequency)
```glsl
// Add uniforms
uniform float uDensityNoiseScale;   // ~0.6
uniform float uDensityContrast;     // ~1.8
uniform vec3 uDensityOffset;        // animated slowly

float clusterDensity(vec3 p) {
  float cluster = 0.5 + 0.5 * snoise(p * uDensityNoiseScale + uDensityOffset);
  cluster = pow(cluster, uDensityContrast); // >1 increases clustering
  return max(cluster, 0.15); // minimum density
}
```

#### D1.3) Combined acceptance sampling
```glsl
// In respawn section:
if (life <= 0.0) {
  vec3 spawnSeed = vec3(uv * 1000.0, uTime * 0.1 + seed);
  
  // Rejection sampling with shell + cluster
  vec3 spawnPos;
  for (int attempt = 0; attempt < 12; attempt++) {
    vec3 candidate = randomInSphere(spawnSeed + float(attempt) * 0.1) * 0.95;
    float r = length(candidate);
    float acceptProb = shellPDF(r) * clusterDensity(candidate);
    
    float acceptRand = hash(dot(spawnSeed.xy, vec2(12.9898, 78.233)) + float(attempt));
    if (acceptRand < acceptProb) {
      spawnPos = candidate;
      break;
    }
    spawnPos = candidate; // fallback
  }
  
  gl_FragColor = vec4(spawnPos, 1.0);
  return;
}
```

### D2) Halo layer: separate point cloud outside the orb
**File:** `src/components/HaloDust.tsx`

```tsx
"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useQualityStore } from "@/lib/qualityStore";

export function HaloDust() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();
  const tier = useQualityStore((s) => s.tier);
  
  const isMobile = tier.tierName === "mobile";
  const particleCount = isMobile ? 800 : 2000;
  
  const getResponsiveRadius = (viewportWidth: number): number => {
    const minWidth = 480;
    const maxWidth = 1200;
    const t = Math.max(0, Math.min(1, (viewportWidth - minWidth) / (maxWidth - minWidth)));
    return 0.5 + (1.0 - 0.5) * (1 - (1 - t) * (1 - t));
  };
  
  const { geometry, uniforms } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    
    const positions = new Float32Array(particleCount * 3);
    const phases = new Float32Array(particleCount);
    const seeds = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      // Thin shell: r = 0.98..1.12
      const r = 0.98 + Math.random() * 0.14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      
      phases[i] = Math.random();
      seeds[i] = Math.random();
    }
    
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    
    return {
      geometry: geo,
      uniforms: {
        uTime: { value: 0 },
        uOrbRadius: { value: 1.0 },
        uRotationSpeed: { value: 0.02 },
      }
    };
  }, [particleCount]);
  
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uOrbRadius.value = getResponsiveRadius(size.width);
    }
  });
  
  // ... shader material with very slow global rotation + slight drift
  // Dust/bokeh sprite mix, low alpha, additive blending
}
```

---

## E) CRITICAL: Rewrite Motion as Flow-Field Advection (P0) (4-8 hours)

### Files to Modify
- `src/lib/particleCompute.ts` — Flow field uniforms, vortex position animation
- `src/shaders/particleSimVelocity.frag` — **COMPLETE REWRITE** with flow field advection

> **This is the make-or-break phase.**
> Goal: nearby particles move together (coherent currents), with embedded secondary swirls, without noisy jitter.

### E0) Stop "force stacking"

**WRONG approach:**
```glsl
vel += globalRot + vortex + curl + turbulence + ...
```

**CORRECT approach:**
```glsl
// 1. Compute a target flow velocity from a divergence-free flow field
vec3 targetVel = flowField(pos);

// 2. Blend current vel toward target vel with inertia
vel = mix(vel, targetVel, followStrength);

// 3. Apply mild constraints: boundary, damping, pointer injection
```

### E1) Build a divergence-free flow field (dominant)

Use curl noise at low frequency as the base field.

**Key trick:** Temporal coherence via domain warping (smoothly moving field), not high-frequency time offsets.

#### E1.1) Domain warp for temporal coherence
```glsl
vec3 domainWarp(vec3 p) {
  return vec3(
    snoise(p * 0.12 + vec3(0.0, 10.0, 20.0) + uTime * 0.02),
    snoise(p * 0.12 + vec3(30.0, 40.0, 50.0) + uTime * 0.02),
    snoise(p * 0.12 + vec3(60.0, 70.0, 80.0) + uTime * 0.02)
  ) * 0.35;
}

vec3 baseFlowField(vec3 p) {
  vec3 warp = domainWarp(p);
  vec3 q = p * 0.18 + warp;  // low freq + warp
  return curlNoise(q);       // divergence-free
}
```

### E2) Add global "galaxy rotation" as part of the field

Compute tangential velocity around Y axis, modulated by shell position:
- Strong in mid shell (where density is)
- Weaker in core and near boundary

```glsl
vec3 galaxyRotation(vec3 p) {
  float r = length(p) / uOrbRadius;  // 0..1
  
  // Shell gain: strong in mid-shell, weak at core and edge
  float shellGain = smoothstep(0.25, 0.55, r) * (1.0 - smoothstep(0.85, 1.0, r));
  
  // Tangent direction for Y-axis rotation
  vec3 rotDir = normalize(vec3(-p.z, 0.0, p.x));
  
  return rotDir * uGlobalRotationSpeed * shellGain;
}
```

### E3) Add 1-2 vortex centers (subtle) INSIDE the field

Use them as flow modifiers (local spiral), not hard attractors:

```glsl
vec3 vortexInfluence(vec3 p, vec3 center) {
  vec3 d = p - center;
  float dist = length(d) + 1e-3;
  
  // Smooth falloff
  float fall = exp(-dist * dist * 6.0);
  
  // Tangent (swirl direction)
  vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), d));
  if (length(t) < 0.1) {
    t = normalize(cross(vec3(1.0, 0.0, 0.0), d));
  }
  
  // No strong inward pull - just swirl
  return t * fall * uVortexStrength;
}
```

### E4) Compose the target velocity

```glsl
// Animate vortex centers slowly
vec3 v0 = vec3(
  sin(uTime * 0.1) * 0.3,
  cos(uTime * 0.07) * 0.2,
  sin(uTime * 0.13) * 0.2
);
vec3 v1 = vec3(
  cos(uTime * 0.08) * 0.25,
  sin(uTime * 0.11) * 0.15,
  cos(uTime * 0.09) * 0.3
);

vec3 targetVel = 
    baseFlowField(pos) * uFlowScale
  + galaxyRotation(pos)
  + vortexInfluence(pos, v0)
  + vortexInfluence(pos, v1);
```

### E5) Follow the field with inertia (this is the "fluid feel")

Particles should coast, but also align to the field:

```glsl
// Follow strength varies by layer (from vertex attributes or encoded in seed)
float follow = uFollowStrength * layerFollowMultiplier;

// Blend toward target (inertia)
vel = mix(vel, targetVel, follow);

// Small drag (not too much - preserve momentum)
vel *= (1.0 - uDrag);
```

**Layer follow multipliers:**
- Dust: `1.8` (follows strongly but slow - feels suspended)
- Body: `1.0` (medium follow)
- Glint: `0.5` (lower follow, higher momentum - streaks)

### E6) Optional: RK2 advection for smoother motion

If you can afford it, do a 2nd order integration step:

```glsl
// RK2 (midpoint method)
vec3 k1 = flowField(pos);
vec3 midPos = pos + k1 * uDeltaTime * 0.5;
vec3 k2 = flowField(midPos);
pos += k2 * uDeltaTime;
```

This reduces "jitter" and improves smoothness.

### E7) Speed shaping: bias glints into occasional fast streams

Instead of constant fast motion, glints enter burst windows then decay:

```glsl
// Encode burst state in velocity.w or seed
// Similar to pause system but inverted: "burst system"
if (isGlint && inBurstWindow) {
  vel *= 2.5; // temporary speed boost
}
```

### E8) Boundary handling: soft confinement

Avoid hard clamps that cause visible "wall hits":

```glsl
float r = length(pos) / uOrbRadius;
float over = smoothstep(0.88, 1.0, r);
vel += (-normalize(pos)) * over * uBoundaryPull;
```

### E9) Pointer interaction: inject swirl into the field

When pointer is near, locally increase rotation and vortex strength rather than adding random impulse:

```glsl
if (uPointerLocal.z > -900.0 && uPointerEnergy > 0.01) {
  vec3 toPointer = uPointerLocal - pos;
  float pointerDist = length(toPointer);
  
  if (pointerDist < 0.5) {
    float falloff = 1.0 - pointerDist / 0.5;
    falloff = falloff * falloff;
    
    // Add swirl around pointer (field injection, not direct force)
    vec3 swirlDir = normalize(cross(vec3(0.0, 1.0, 0.0), toPointer));
    targetVel += swirlDir * uPointerEnergy * falloff * 2.0;
  }
}
```

### E10) Complete velocity shader structure
**File:** `src/shaders/particleSimVelocity.frag`

```glsl
void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);
  
  vec3 pos = posData.xyz;
  float life = posData.w;
  vec3 vel = velData.xyz;
  float seed = velData.w;
  
  // Skip if dead (respawn handled in position shader)
  if (life <= 0.0) {
    // Initial velocity for respawned particle
    vec3 randomDir = randomOnSphere(seed + uTime);
    gl_FragColor = vec4(randomDir * 0.2, seed);
    return;
  }
  
  // Decode layer from seed (or use separate texture)
  float layer = decodeLayer(seed);
  float followMult = getLayerFollowMultiplier(layer);
  
  // ========================================
  // BUILD TARGET FLOW VELOCITY
  // ========================================
  
  vec3 targetVel = vec3(0.0);
  
  // 1. Base flow field (divergence-free curl noise with domain warp)
  targetVel += baseFlowField(pos) * uFlowScale;
  
  // 2. Galaxy rotation (shell-modulated)
  targetVel += galaxyRotation(pos);
  
  // 3. Vortex influences (subtle)
  targetVel += vortexInfluence(pos, uVortex0);
  targetVel += vortexInfluence(pos, uVortex1);
  
  // 4. Pointer swirl injection
  targetVel += pointerSwirl(pos);
  
  // ========================================
  // FOLLOW FIELD WITH INERTIA
  // ========================================
  
  float follow = uFollowStrength * followMult;
  vel = mix(vel, targetVel, follow);
  
  // ========================================
  // CONSTRAINTS
  // ========================================
  
  // Drag (small)
  vel *= (1.0 - uDrag);
  
  // Soft boundary
  float r = length(pos) / uOrbRadius;
  float over = smoothstep(0.88, 1.0, r);
  vel += (-normalize(pos)) * over * uBoundaryPull;
  
  // Speed limit
  float speed = length(vel);
  if (speed > uMaxSpeed) {
    vel = normalize(vel) * uMaxSpeed;
  }
  
  gl_FragColor = vec4(vel, seed);
}
```

---

## F) Selective Bloom + Tone Mapping + Film Grain (P1) (2-4 hours)

### Files to Create
- `src/components/Effects.tsx` — Bloom + ACES tone mapping

### Files to Modify
- `src/components/Scene.tsx` — Add Effects component
- `src/shaders/sparkles.frag` — Ensure only glints output HDR values

### F1) Bloom must only trigger on glints (top ~5-10%)

**Rule:** Most particles should remain LDR-ish. Only glints go HDR.

- Dust/body: brightness capped around 0.8–1.0
- Glints: allow 1.2–2.2 (careful)

### F2) Use ACES filmic tone mapping

**File:** `src/components/Effects.tsx`

```tsx
import { EffectComposer, Bloom, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

export function Effects() {
  return (
    <EffectComposer>
      <Bloom
        intensity={0.5}
        luminanceThreshold={0.88}  // High threshold - only glints
        luminanceSmoothing={0.35}
        mipmapBlur
      />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
}
```

### F3) Optional: Selective bloom (best last-mile)

If using selection-based bloom:
- Render glints with a selection tag
- Bloom only selected

If not, rely on high `luminanceThreshold` (0.85–0.92) so only glints exceed it.

### F4) Add subtle film grain overlay

Either:
- Full-screen noise in post, or
- Slight dither in particle shader (already in B4)

Keep grain **subtle**. Goal is to remove "perfect gradients."

---

## G) Micro Behaviors: Hover/Pauses + Twinkle (P2) (2-4 hours)

### Files to Modify
- `src/shaders/particleSimVelocity.frag` — Pause state encoding/decoding
- `src/shaders/sparkles.frag` — Layer-based twinkle rates

### G1) Pauses should apply mainly to Dust

Use `velocity.w` for state:
- `0` = normal
- `>0` = pauseEndTime (or negative encoding)

Dust particles have higher pause chance.

```glsl
// In velocity shader
float pauseChance = (layer < 0.5) ? 0.003 : 0.0005; // Dust pauses more

if (!isPaused && rand < pauseChance) {
  // Enter pause state
  float pauseDuration = 0.5 + rand * 2.5;
  // Encode pause end time...
}

if (isPaused) {
  vel *= 0.02; // Nearly stopped, slight drift
}
```

### G2) Twinkle tied to layer

| Layer | Twinkle Character |
|-------|-------------------|
| Dust | Almost no flicker |
| Body | Slow, gentle flicker |
| Glint | Quick micro-twinkle |

```glsl
// In fragment shader
float twinkleSpeed = (vLayer < 0.5) ? 0.5 : (vLayer < 1.5) ? 2.0 : 6.0;
float twinkleAmp = (vLayer < 0.5) ? 0.05 : (vLayer < 1.5) ? 0.15 : 0.3;
float twinkle = 1.0 - twinkleAmp + twinkleAmp * 2.0 * sin(uTime * twinkleSpeed + vTwinkle * 6.28318);
```

---

## H) Hero "Streams" — Use as Flow Injectors (P2) (Optional, High polish)

### Files to Create
- `src/lib/heroStreams.ts` — Curve definitions, baking to texture

### Files to Modify
- `src/lib/particleCompute.ts` — Load hero curve textures as uniforms
- `src/shaders/particleSimVelocity.frag` — Sample curve distance field, add tangential influence

Instead of rendering 5 obvious spline streams:

1. Keep the curve library
2. Bake curves to textures
3. In velocity shader, sample distance to curve field and add a subtle tangential "stream velocity" that influences nearby particles

This creates choreography **without visible ribbons**.

```glsl
// Sample distance to nearest hero curve
float distToCurve = sampleCurveDistanceField(pos);
vec3 curveTangent = sampleCurveTangent(pos);

// Add stream influence when near curve
float streamInfluence = smoothstep(0.15, 0.0, distToCurve);
targetVel += curveTangent * streamInfluence * uHeroStreamStrength;
```

If you still want **visible** hero streams:
- Limit to 1–2 at a time
- Very low opacity
- Mostly glint sprites (rare)

---

## 3) Concrete Phase Checklist (Deliverable-Level)

### Phase A — Production Gating
- [ ] Leva gated behind `NODE_ENV === "development"`
- [ ] Default values for all controls

### Phase B — Sprites + Attributes
- [ ] Add 3 sprites (dust/bokeh/glint) to `public/textures/`
- [ ] Add `aLayer`, `aSprite`, `aRot`, `aAspect`, `aTwinkle` attributes
- [ ] Replace circle discard with sprite sampling
- [ ] Add subtle dither

### Phase C — Layering Rules
- [ ] Dust/body/glint distributions (45%/48%/5%)
- [ ] Size/brightness/speed/followStrength by layer
- [ ] Glints are the only HDR/bloom drivers

### Phase D — Spawn Structure
- [ ] Shell PDF + cluster noise acceptance sampling
- [ ] Add separate halo particle system (outside sphere)

### Phase E — Motion Rewrite (CRITICAL)
- [ ] Build coherent flow field (low frequency curl + domain warp)
- [ ] Add rotation inside field (shell-modulated)
- [ ] Add 1–2 vortex modifiers (subtle)
- [ ] Inertia blending toward target field velocity
- [ ] Soft boundary confinement
- [ ] Pointer swirl injection via field parameters

### Phase F — Post
- [ ] Bloom threshold high (0.88+) + ACES
- [ ] Ensure only glints exceed threshold
- [ ] Optional selective bloom for glints

### Phase G — Micro Life
- [ ] Dust hover/pauses (natural, not "lag")
- [ ] Twinkle correlated to layer

### Phase H — Optional Flow Choreography
- [ ] Hero curves as velocity field injectors (not visible ribbons)

---

## 4) Acceptance Criteria (If you hit these, you're "Blueyard-close")

### Particle Character
- [ ] Dust reads as subpixel haze (you "feel" it, not see each dot)
- [ ] Body has bokeh softness, not uniform dots
- [ ] Glints are rare, bright, crisp, and trigger bloom
- [ ] No "perfect circles everywhere" look

### Structure
- [ ] Orb reads as core + shell volume
- [ ] Outer silhouette has a halo dust polish
- [ ] Density feels intentional (clusters + sparse pockets)

### Motion (Most Important)
- [ ] You can perceive large coherent currents over 3–6 seconds
- [ ] Embedded smaller swirls exist without jitter
- [ ] Glints occasionally streak faster than the background
- [ ] Pointer interaction "stirs" the field, not just pushes particles

### Post / Filmic
- [ ] Bloom exists but does not wash out the orb
- [ ] Tone mapping feels cinematic (ACES)
- [ ] No banding / overly clean gradients

---

## 5) Performance Notes (Keep It 60fps)

### Tiering

| Feature | Mobile | Desktop |
|---------|--------|---------|
| Dust count | 50% reduction | Full |
| Halo | Disabled or 500 pts | 2000 pts |
| Bloom | Disabled or reduced | Full |
| RK2 advection | Skip | Optional |
| Vortex cores | 1 | 2 |

### Optimization
- Prefer one sim and layer via attributes (cheaper than multiple sims)
- Use sprites efficiently (3 textures OK)
- Keep advection sampling reasonable

---

## 6) Minimal Parameter Defaults (Good Starting Point)

### Motion
| Parameter | Value |
|-----------|-------|
| `uFlowScale` | 0.8 |
| `uGlobalRotationSpeed` | 0.18 |
| `uVortexStrength` | 0.25 (keep subtle) |
| `uFollowStrength` (dust) | 0.22 |
| `uFollowStrength` (body) | 0.12 |
| `uFollowStrength` (glint) | 0.06 |
| `uDrag` | 0.006 |
| `uBoundaryPull` | 0.8 (soft) |
| `uMaxSpeed` | 3.0 |

### Bloom
| Parameter | Value |
|-----------|-------|
| `intensity` | 0.35–0.65 |
| `threshold` | 0.88 |
| `smoothing` | 0.25–0.45 |

### Layer Distribution
- Dust: 45%
- Body: 48%
- Glint: 5%
- Halo: ~2k points (separate system)

---

## 7) Implementation Notes (Avoid Common "Almost There" Failures)

| Problem | Solution |
|---------|----------|
| Everything blooms | Raise threshold + reduce HDR on body/dust |
| Motion looks jittery | Lower noise frequency + add domain warp + consider RK2 |
| Looks like obvious math | Reduce vortex strength and turbulence; increase coherence |
| Still looks "flat" | Add halo + sprite textures + shell density bias |
| Particles look uniform | Use sprites + rotation + aspect variation |
| No depth perception | Shell spawn distribution + dust layer + halo |

---

## End State

When done, your orb should read like:

> A volumetric, glowing dust sphere with choreographed, fluid currents, sparkling with rare glints, surrounded by a subtle halo polish, with motion that feels **simulated rather than computed**.

This is the "last mile" path.
