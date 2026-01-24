# Phase 3.5: GPU Particle Fountain System — Atomic Checklist

Transform static particles into a living, breathing fountain of dust using GPUComputationRenderer.

---

## 1. GPUComputationRenderer Infrastructure

### 1.1 Install Dependencies
- [ ] 1.1.1 Verify `three` version supports GPUComputationRenderer (r128+)
- [ ] 1.1.2 Import GPUComputationRenderer from `three/examples/jsm/misc/GPUComputationRenderer.js`

### 1.2 Create Particle Compute Module
- [ ] 1.2.1 Create new file `src/lib/particleCompute.ts`
- [ ] 1.2.2 Define `ParticleCompute` class with constructor accepting `renderer: THREE.WebGLRenderer`
- [ ] 1.2.3 Define texture dimensions constant (256x256 = 65,536 max particles)
- [ ] 1.2.4 Add `particleCount` parameter (desktop: 50,000, mobile: 15,000)

### 1.3 Initialize GPUComputationRenderer
- [ ] 1.3.1 Create `GPUComputationRenderer` instance with texture width/height
- [ ] 1.3.2 Call `gpuCompute.setDataType(THREE.FloatType)` for precision
- [ ] 1.3.3 Store reference to `gpuCompute` on class instance

### 1.4 Create Position Data Texture
- [ ] 1.4.1 Call `gpuCompute.createTexture()` for position texture
- [ ] 1.4.2 Initialize position texture data array
- [ ] 1.4.3 For each particle index i (0 to particleCount):
  - [ ] 1.4.3.1 Generate random point inside sphere with radius 0.2 (spawn clump)
  - [ ] 1.4.3.2 Set `data[i * 4 + 0]` = x position
  - [ ] 1.4.3.3 Set `data[i * 4 + 1]` = y position
  - [ ] 1.4.3.4 Set `data[i * 4 + 2]` = z position
  - [ ] 1.4.3.5 Set `data[i * 4 + 3]` = life (random 0.0-1.0 for staggered deaths)
- [ ] 1.4.4 Fill remaining texture pixels (beyond particleCount) with zeros

### 1.5 Create Velocity Data Texture
- [ ] 1.5.1 Call `gpuCompute.createTexture()` for velocity texture
- [ ] 1.5.2 Initialize velocity texture data array
- [ ] 1.5.3 For each particle index i (0 to particleCount):
  - [ ] 1.5.3.1 Generate small random initial velocity (magnitude ~0.01-0.05)
  - [ ] 1.5.3.2 Set `data[i * 4 + 0]` = vx
  - [ ] 1.5.3.3 Set `data[i * 4 + 1]` = vy
  - [ ] 1.5.3.4 Set `data[i * 4 + 2]` = vz
  - [ ] 1.5.3.5 Set `data[i * 4 + 3]` = seed (random 0.0-1.0 for noise variation)

### 1.6 Create Compute Variables
- [ ] 1.6.1 Add position variable: `gpuCompute.addVariable('texturePosition', positionShader, positionTexture)`
- [ ] 1.6.2 Add velocity variable: `gpuCompute.addVariable('textureVelocity', velocityShader, velocityTexture)`
- [ ] 1.6.3 Set position dependencies: `gpuCompute.setVariableDependencies(positionVar, [positionVar, velocityVar])`
- [ ] 1.6.4 Set velocity dependencies: `gpuCompute.setVariableDependencies(velocityVar, [positionVar, velocityVar])`

### 1.7 Add Uniforms to Compute Variables
- [ ] 1.7.1 Add `uTime` uniform to position variable (float, initial 0.0)
- [ ] 1.7.2 Add `uDeltaTime` uniform to position variable (float, initial 0.016)
- [ ] 1.7.3 Add `uOrbRadius` uniform to position variable (float, initial 1.0)
- [ ] 1.7.4 Add `uPointerLocal` uniform to position variable (vec3, initial [0,0,-999])
- [ ] 1.7.5 Add `uPointerEnergy` uniform to position variable (float, initial 0.0)
- [ ] 1.7.6 Add `uSpawnRadius` uniform to position variable (float, initial 0.2)
- [ ] 1.7.7 Add `uLifeDecay` uniform to position variable (float, initial 0.15)
- [ ] 1.7.8 Copy same uniforms to velocity variable

### 1.8 Initialize GPU Compute
- [ ] 1.8.1 Call `gpuCompute.init()` and check for errors
- [ ] 1.8.2 Store references to position/velocity render targets
- [ ] 1.8.3 Export method `getPositionTexture()` returning current position render target texture
- [ ] 1.8.4 Export method `getVelocityTexture()` returning current velocity render target texture

### 1.9 Create Update Method
- [ ] 1.9.1 Create `update(time, deltaTime, orbRadius, pointerLocal, pointerEnergy)` method
- [ ] 1.9.2 Update `uTime` uniform value
- [ ] 1.9.3 Update `uDeltaTime` uniform value (clamped to max 0.05 to prevent jumps)
- [ ] 1.9.4 Update `uOrbRadius` uniform value
- [ ] 1.9.5 Update `uPointerLocal` uniform value
- [ ] 1.9.6 Update `uPointerEnergy` uniform value
- [ ] 1.9.7 Call `gpuCompute.compute()`

### 1.10 Create Dispose Method
- [ ] 1.10.1 Create `dispose()` method
- [ ] 1.10.2 Dispose position texture
- [ ] 1.10.3 Dispose velocity texture
- [ ] 1.10.4 Dispose GPUComputationRenderer

---

## 2. Simulation Shaders

### 2.1 Create Position Simulation Shader
- [ ] 2.1.1 Create new file `src/shaders/particleSimPosition.frag`
- [ ] 2.1.2 Add precision statement `precision highp float;`
- [ ] 2.1.3 Declare uniform `float uTime;`
- [ ] 2.1.4 Declare uniform `float uDeltaTime;`
- [ ] 2.1.5 Declare uniform `float uOrbRadius;`
- [ ] 2.1.6 Declare uniform `vec3 uPointerLocal;`
- [ ] 2.1.7 Declare uniform `float uPointerEnergy;`
- [ ] 2.1.8 Declare uniform `float uSpawnRadius;`
- [ ] 2.1.9 Declare uniform `float uLifeDecay;`

### 2.2 Inline Noise Functions in Position Shader
- [ ] 2.2.1 Copy `mod289(vec3)` function
- [ ] 2.2.2 Copy `mod289(vec4)` function
- [ ] 2.2.3 Copy `permute(vec4)` function
- [ ] 2.2.4 Copy `taylorInvSqrt(vec4)` function
- [ ] 2.2.5 Copy `snoise(vec3)` function (returns -1 to 1)
- [ ] 2.2.6 Add `curlNoise(vec3 p)` function using finite differences of snoise

### 2.3 Add Hash Functions for Randomness
- [ ] 2.3.1 Add `hash(float n)` function returning pseudo-random 0-1
- [ ] 2.3.2 Add `hash3(vec2 p)` function returning vec3 of pseudo-random values
- [ ] 2.3.3 Add `randomInSphere(vec3 seed)` function returning random point in unit sphere

### 2.4 Position Shader Main Function
- [ ] 2.4.1 Sample current position: `vec4 pos = texture2D(texturePosition, gl_FragCoord.xy / resolution.xy);`
- [ ] 2.4.2 Sample current velocity: `vec4 vel = texture2D(textureVelocity, gl_FragCoord.xy / resolution.xy);`
- [ ] 2.4.3 Extract position xyz and life from pos.w
- [ ] 2.4.4 Extract velocity xyz and seed from vel.w

### 2.5 Respawn Logic (When Life <= 0)
- [ ] 2.5.1 Check `if (life <= 0.0)`
- [ ] 2.5.2 Generate new seed based on gl_FragCoord and uTime
- [ ] 2.5.3 Generate spawn position using `randomInSphere(seed) * uSpawnRadius`
- [ ] 2.5.4 Set life to 1.0
- [ ] 2.5.5 Output respawned position: `gl_FragColor = vec4(newPos, 1.0);`
- [ ] 2.5.6 Add `return;` to exit early

### 2.6 Position Integration (When Alive)
- [ ] 2.6.1 Add velocity to position: `pos.xyz += vel.xyz * uDeltaTime;`
- [ ] 2.6.2 Decrement life: `life -= uLifeDecay * uDeltaTime;`
- [ ] 2.6.3 Clamp life to minimum 0.0

### 2.7 Boundary Enforcement
- [ ] 2.7.1 Calculate distance from center: `float dist = length(pos.xyz);`
- [ ] 2.7.2 If `dist > uOrbRadius * 0.88`, clamp position to boundary
- [ ] 2.7.3 Normalize and scale: `pos.xyz = normalize(pos.xyz) * uOrbRadius * 0.88;`

### 2.8 Output Position
- [ ] 2.8.1 Output final position with life: `gl_FragColor = vec4(pos.xyz, life);`

### 2.9 Create Velocity Simulation Shader
- [ ] 2.9.1 Create new file `src/shaders/particleSimVelocity.frag`
- [ ] 2.9.2 Add same precision and uniform declarations as position shader
- [ ] 2.9.3 Inline same noise functions

### 2.10 Velocity Shader Main Function
- [ ] 2.10.1 Sample current position from texturePosition
- [ ] 2.10.2 Sample current velocity from textureVelocity
- [ ] 2.10.3 Extract position xyz, life, velocity xyz, seed

### 2.11 Curl Noise Force
- [ ] 2.11.1 Calculate curl noise input: `vec3 noisePos = pos.xyz * 2.0 + uTime * 0.1;`
- [ ] 2.11.2 Sample curl noise: `vec3 curl = curlNoise(noisePos);`
- [ ] 2.11.3 Scale curl force: `curl *= 0.5;`
- [ ] 2.11.4 Add curl to velocity: `vel.xyz += curl * uDeltaTime;`

### 2.12 Radial Drift Force (Fountain Effect)
- [ ] 2.12.1 Calculate radial direction: `vec3 radial = normalize(pos.xyz);`
- [ ] 2.12.2 Add slight outward drift: `vel.xyz += radial * 0.02 * uDeltaTime;`

### 2.13 Center Attraction (Keeps Particles from Flying Away)
- [ ] 2.13.1 Calculate distance from center
- [ ] 2.13.2 If distance > 0.5 * uOrbRadius, add inward force
- [ ] 2.13.3 Inward force: `vel.xyz -= radial * 0.05 * uDeltaTime;`

### 2.14 Pointer Vortex Injection
- [ ] 2.14.1 Check if pointer is active: `if (uPointerLocal.z > -900.0)`
- [ ] 2.14.2 Calculate vector from particle to pointer: `vec3 toPointer = uPointerLocal - pos.xyz;`
- [ ] 2.14.3 Calculate distance to pointer: `float pointerDist = length(toPointer);`
- [ ] 2.14.4 If within influence radius (< 0.3):
  - [ ] 2.14.4.1 Calculate tangent direction (perpendicular to toPointer)
  - [ ] 2.14.4.2 Calculate falloff: `float falloff = 1.0 - pointerDist / 0.3;`
  - [ ] 2.14.4.3 Add tangential impulse: `vel.xyz += tangent * uPointerEnergy * falloff * 2.0;`

### 2.15 Velocity Damping
- [ ] 2.15.1 Apply damping: `vel.xyz *= 0.98;`
- [ ] 2.15.2 Clamp max velocity: `vel.xyz = clamp(vel.xyz, vec3(-1.0), vec3(1.0));`

### 2.16 Output Velocity
- [ ] 2.16.1 Output final velocity with seed preserved: `gl_FragColor = vec4(vel.xyz, seed);`

---

## 3. Sparkles Component Integration

### 3.1 Import GPU Compute
- [ ] 3.1.1 Import `ParticleCompute` class from `@/lib/particleCompute`
- [ ] 3.1.2 Import simulation shaders as raw strings

### 3.2 Initialize GPU Compute in Component
- [ ] 3.2.1 Get WebGL renderer from `useThree()`: `const { gl } = useThree();`
- [ ] 3.2.2 Create `particleComputeRef = useRef<ParticleCompute | null>(null)`
- [ ] 3.2.3 In `useMemo` or `useEffect`, initialize: `particleComputeRef.current = new ParticleCompute(gl, particleCount)`
- [ ] 3.2.4 Add cleanup in useEffect return: `particleComputeRef.current?.dispose()`

### 3.3 Update Particle Count Constants
- [ ] 3.3.1 Change `PARTICLE_COUNT_DESKTOP` from 8000 to 50000
- [ ] 3.3.2 Change `PARTICLE_COUNT_MOBILE` from 2500 to 15000

### 3.4 Create UV Attribute for Texture Sampling
- [ ] 3.4.1 Calculate texture width/height (256)
- [ ] 3.4.2 Create `uvs` Float32Array of size `particleCount * 2`
- [ ] 3.4.3 For each particle i:
  - [ ] 3.4.3.1 Calculate `u = (i % textureWidth + 0.5) / textureWidth`
  - [ ] 3.4.3.2 Calculate `v = (Math.floor(i / textureWidth) + 0.5) / textureHeight`
  - [ ] 3.4.3.3 Set `uvs[i * 2] = u`
  - [ ] 3.4.3.4 Set `uvs[i * 2 + 1] = v`
- [ ] 3.4.4 Add uv attribute to geometry: `geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2))`

### 3.5 Remove Old Position Buffer
- [ ] 3.5.1 Remove old `positions` useMemo that generated random positions
- [ ] 3.5.2 Remove `position` attribute from geometry (GPU compute provides positions)
- [ ] 3.5.3 Keep `aPhase` and `aIsWhite` attributes

### 3.6 Add Position Texture Uniform
- [ ] 3.6.1 Add `texturePosition: { value: null }` to uniforms
- [ ] 3.6.2 Add `textureVelocity: { value: null }` to uniforms (optional, for debug)

### 3.7 Update useFrame
- [ ] 3.7.1 Get deltaTime: `const delta = state.clock.getDelta()`
- [ ] 3.7.2 Clamp deltaTime: `const dt = Math.min(delta, 0.05)`
- [ ] 3.7.3 Call `particleComputeRef.current?.update(time, dt, orbRadius, pointerLocal, pointerEnergy)`
- [ ] 3.7.4 Get position texture: `const posTexture = particleComputeRef.current?.getPositionTexture()`
- [ ] 3.7.5 Set uniform: `u.texturePosition.value = posTexture`

### 3.8 Add Dummy Position Attribute for Three.js
- [ ] 3.8.1 Create dummy `position` attribute (required by Three.js for bounding sphere)
- [ ] 3.8.2 Fill with zeros or single point at origin
- [ ] 3.8.3 Manually set bounding sphere: `geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), orbRadius)`

---

## 4. Vertex Shader Updates

### 4.1 Add Texture Sampling
- [ ] 4.1.1 Add `uniform sampler2D texturePosition;` declaration
- [ ] 4.1.2 Add `attribute vec2 aUv;` declaration for texture lookup

### 4.2 Sample Position from Texture
- [ ] 4.2.1 In main(), sample position: `vec4 posData = texture2D(texturePosition, aUv);`
- [ ] 4.2.2 Extract position: `vec3 particlePos = posData.xyz;`
- [ ] 4.2.3 Extract life: `float life = posData.w;`

### 4.3 Remove Old Procedural Motion
- [ ] 4.3.1 Remove curl noise calculation (now in GPU compute)
- [ ] 4.3.2 Remove toroidal convection calculation
- [ ] 4.3.3 Remove vortex injection (now in GPU compute)
- [ ] 4.3.4 Keep only rendering logic

### 4.4 Life-Based Size
- [ ] 4.4.1 Add life to size calculation: `float lifeSize = mix(0.3, 1.0, life);`
- [ ] 4.4.2 Multiply base size by lifeSize
- [ ] 4.4.3 Particles shrink as they age

### 4.5 Pass Life to Fragment Shader
- [ ] 4.5.1 Add `varying float vLife;` declaration
- [ ] 4.5.2 Set `vLife = life;` in main()

### 4.6 Update World Position Calculation
- [ ] 4.6.1 Use `particlePos * uOrbRadius` for world position
- [ ] 4.6.2 Apply modelViewMatrix: `vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);`

---

## 5. Fragment Shader Updates

### 5.1 Add Life Varying
- [ ] 5.1.1 Add `varying float vLife;` declaration

### 5.2 Life-Based Opacity
- [ ] 5.2.1 Calculate life opacity: `float lifeAlpha = smoothstep(0.0, 0.2, vLife);`
- [ ] 5.2.2 Multiply final alpha by lifeAlpha
- [ ] 5.2.3 Particles fade out as life approaches 0

### 5.3 Keep Existing Rendering
- [ ] 5.3.1 Keep 3D sphere shading for base particles
- [ ] 5.3.2 Keep glowing white accents
- [ ] 5.3.3 Keep depth-based transparency

---

## 6. Bloom Post-Processing

### 6.1 Add Bloom to Scene
- [ ] 6.1.1 Import `EffectComposer` from `@react-three/postprocessing`
- [ ] 6.1.2 Import `Bloom` from `@react-three/postprocessing`

### 6.2 Configure Bloom Effect
- [ ] 6.2.1 Add `<EffectComposer>` wrapper around scene content
- [ ] 6.2.2 Add `<Bloom>` component inside EffectComposer
- [ ] 6.2.3 Set `luminanceThreshold={0.4}` (only bright spots glow)
- [ ] 6.2.4 Set `luminanceSmoothing={0.9}` (smooth transition)
- [ ] 6.2.5 Set `intensity={0.5}` (moderate glow)
- [ ] 6.2.6 Set `radius={0.4}` (tight glint radius)

### 6.3 Add Bloom Controls to Leva
- [ ] 6.3.1 Add "Post Processing" folder to Leva
- [ ] 6.3.2 Add `bloomEnabled` toggle (default true)
- [ ] 6.3.3 Add `bloomIntensity` slider (0-2, default 0.5)
- [ ] 6.3.4 Add `bloomThreshold` slider (0-1, default 0.4)
- [ ] 6.3.5 Conditionally render Bloom based on `bloomEnabled`

---

## 7. Performance Optimization

### 7.1 Quality Tier Adjustments
- [ ] 7.1.1 In mobile tier, reduce particle count to 15,000
- [ ] 7.1.2 In mobile tier, reduce texture size to 128x128 (16,384 max)
- [ ] 7.1.3 In mobile tier, disable bloom or reduce intensity

### 7.2 Frame Budget Management
- [ ] 7.2.1 Add FPS counter to debug panel
- [ ] 7.2.2 If FPS drops below 30, reduce particle count dynamically
- [ ] 7.2.3 Clamp deltaTime to prevent physics explosion on tab switch

### 7.3 Memory Management
- [ ] 7.3.1 Dispose GPU compute on component unmount
- [ ] 7.3.2 Dispose textures on quality tier change
- [ ] 7.3.3 Avoid creating new objects in render loop

---

## 8. Validation & Testing

### 8.1 Visual Validation
- [ ] 8.1.1 Verify particles spawn in distributed clump near center
- [ ] 8.1.2 Verify particles drift outward over time
- [ ] 8.1.3 Verify particles fade and shrink as they age
- [ ] 8.1.4 Verify dead particles respawn (continuous flow)
- [ ] 8.1.5 Verify curl noise creates organic swirling motion
- [ ] 8.1.6 Verify pointer stirring creates visible vortex
- [ ] 8.1.7 Verify bloom creates shimmering glow on bright particles
- [ ] 8.1.8 Verify particles stay inside orb boundary

### 8.2 Performance Validation
- [ ] 8.2.1 Verify 60fps on desktop with 50k particles
- [ ] 8.2.2 Verify 30fps+ on mobile with 15k particles
- [ ] 8.2.3 Verify no memory leaks (stable memory over time)
- [ ] 8.2.4 Verify no GC jitter (smooth animation)

### 8.3 Edge Case Testing
- [ ] 8.3.1 Test window resize (responsive radius)
- [ ] 8.3.2 Test tab switch (deltaTime clamping)
- [ ] 8.3.3 Test rapid pointer movement
- [ ] 8.3.4 Test mobile Safari (WebGL2 compatibility)

---

## Summary

**Total Tasks: 167**

| Section | Task Count |
|---------|------------|
| 1. GPU Compute Infrastructure | 38 |
| 2. Simulation Shaders | 43 |
| 3. Sparkles Component Integration | 27 |
| 4. Vertex Shader Updates | 14 |
| 5. Fragment Shader Updates | 6 |
| 6. Bloom Post-Processing | 11 |
| 7. Performance Optimization | 9 |
| 8. Validation & Testing | 19 |

