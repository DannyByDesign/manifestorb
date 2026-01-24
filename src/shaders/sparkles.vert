// Sparkles Vertex Shader (GPU-First Procedural Motion)
// Multi-scale curl noise flow with vortex injection
// All noise functions inlined (no include system)

precision highp float;

// ============================================
// Attributes (static, never updated)
// ============================================
// 'position' is the standard Three.js attribute - contains seed positions in unit sphere
attribute float aPhase;    // Random phase 0 to 2π for flicker timing
attribute float aIsWhite;  // 1.0 for white accent, 0.0 for base color

// ============================================
// Uniforms
// ============================================
uniform float uTime;
uniform float uOrbRadius;       // Responsive orb radius (world space)
uniform vec3 uPointerLocal;     // 3D hit point in local unit-sphere coords (or sentinel z < -900)
uniform float uPointerEnergy;   // 0-1 based on pointer velocity
uniform float uMorphFade;       // 1.0 when orb visible, 0.0 when morphed

// ============================================
// Varyings (passed to fragment shader)
// ============================================
varying float vDepthFade;   // 1.0 = near/bright, 0.0 = far/dim
varying float vRadialFade;  // 1.0 = center, 0.0 = edge (for halo effect)
varying float vPhase;       // Pass phase for fragment flicker
varying float vIsWhite;     // Pass white accent flag
varying float vMorphFade;   // Pass morph visibility

// ============================================
// Noise Library (Simplex Noise) - INLINED
// ============================================
// 3D Simplex Noise by Ian McEwan, Stefan Gustavson

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

// Returns value in range [-1, 1]
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points over a square, mapped onto an octahedron
  float n_ = 0.142857142857; // 1.0/7.0
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix contributions
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// Curl noise - compute curl of 3D noise field
// Uses offset seeds (31.416, 47.853, 63.291) to create independent noise fields
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  
  float n_x0 = snoise(p - dx);
  float n_x1 = snoise(p + dx);
  float n_y0 = snoise(p - dy);
  float n_y1 = snoise(p + dy);
  float n_z0 = snoise(p - dz);
  float n_z1 = snoise(p + dz);
  
  // Use offset samples for different components (avoids collapsed fields)
  float n_x0_y = snoise(p - dx + vec3(31.416, 0.0, 0.0));
  float n_x1_y = snoise(p + dx + vec3(31.416, 0.0, 0.0));
  float n_y0_z = snoise(p - dy + vec3(0.0, 47.853, 0.0));
  float n_y1_z = snoise(p + dy + vec3(0.0, 47.853, 0.0));
  float n_z0_x = snoise(p - dz + vec3(0.0, 0.0, 63.291));
  float n_z1_x = snoise(p + dz + vec3(0.0, 0.0, 63.291));
  
  float curl_x = (n_y1_z - n_y0_z) - (n_z1 - n_z0);
  float curl_y = (n_z1_x - n_z0_x) - (n_x1 - n_x0);
  float curl_z = (n_x1_y - n_x0_y) - (n_y1 - n_y0);
  
  return vec3(curl_x, curl_y, curl_z) / (2.0 * e);
}

// ============================================
// Main
// ============================================
void main() {
  // Seed position from static 'position' attribute (unit sphere)
  vec3 seed = position;
  
  // ========================================
  // COHERENT STREAM MOTION (plasma-like currents)
  // Key: LOW frequency noise = nearby particles move TOGETHER
  // ========================================
  
  // Step 1: Very gentle domain warp (maintains coherence)
  vec3 warpInput = seed * 0.3 + uTime * 0.015;
  vec3 warpOffset = curlNoise(warpInput) * 0.08;
  vec3 warpedSeed = seed + warpOffset;
  
  // Step 2: PRIMARY STREAM FLOW - very low frequency for coherent streams
  // All particles in a region get nearly identical flow vectors
  vec3 streamInput = warpedSeed * 0.4 + vec3(uTime * 0.025, uTime * 0.02, uTime * 0.018);
  vec3 streamFlow = curlNoise(streamInput) * 0.35;
  
  // Step 3: Secondary flow - medium frequency for some variation
  vec3 secondaryInput = warpedSeed * 0.8 + uTime * 0.04;
  vec3 secondaryFlow = curlNoise(secondaryInput) * 0.12;
  
  // NO small-scale turbulence - that's what makes motion feel random
  
  // Step 4: Toroidal convection (circular flow like plasma in sun)
  float radius = length(seed.xz);
  
  // Circular flow around Y axis (tangential)
  vec3 toroidal = vec3(-seed.z, 0.0, seed.x) * 0.06;
  
  // Vertical circulation: up in center column, down at edges
  float verticalFlow = (0.35 - radius) * 0.05;
  toroidal.y += verticalFlow;
  
  // Step 5: Slow global rotation
  float rotAngle = uTime * 0.02;
  float cosA = cos(rotAngle);
  float sinA = sin(rotAngle);
  vec3 rotatedSeed = vec3(
    seed.x * cosA - seed.z * sinA,
    seed.y,
    seed.x * sinA + seed.z * cosA
  );
  vec3 rotationOffset = (rotatedSeed - seed) * 0.15;
  
  // Combine all flow layers
  // Base position slightly contracted to allow flow expansion
  vec3 localPos = seed * 0.78 + streamFlow + secondaryFlow + toroidal + rotationOffset;
  
  // ========================================
  // VORTEX INJECTION (cursor interaction)
  // ========================================
  
  if (uPointerLocal.z > -900.0) {
    vec3 toPointer = localPos - uPointerLocal;
    float dist = length(toPointer);
    
    vec3 tangent = normalize(cross(toPointer, vec3(0.0, 1.0, 0.0)));
    if (length(tangent) < 0.001) {
      tangent = vec3(1.0, 0.0, 0.0);
    }
    
    float vortexFalloff = smoothstep(0.6, 0.0, dist) * uPointerEnergy * 0.5;
    localPos += tangent * vortexFalloff;
  }
  
  // ========================================
  // RADIAL FADE FOR HALO EFFECT
  // ========================================
  
  float localRadius = length(localPos);
  
  // Radial fade: 1.0 at center, fades to 0 at edges and beyond
  // Starts fading at 0.75 radius, fully faded at 1.0 radius
  vRadialFade = 1.0 - smoothstep(0.75, 1.0, localRadius);
  
  // Soft guidance for extreme outliers
  if (localRadius > 1.05) {
    localPos = normalize(localPos) * 1.05;
  }
  
  // Scale to world space with 0.88 factor (particles stay within orb)
  vec3 worldPos = localPos * uOrbRadius * 0.88;
  
  // ========================================
  // DEPTH FADE (computed in shader)
  // ========================================
  
  vec4 orbCenterView = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float orbCenterZ = -orbCenterView.z;
  
  vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
  float particleZ = -mvPos.z;
  
  // Wider depth range for better 3D perception
  float zNear = orbCenterZ - uOrbRadius * 1.2;
  float zFar = orbCenterZ + uOrbRadius * 1.2;
  
  // Squared depth for more dramatic front-to-back difference
  float rawDepth = 1.0 - smoothstep(zNear, zFar, particleZ);
  vDepthFade = rawDepth * rawDepth; // Square for more pop
  
  // ========================================
  // POINT SIZE (dramatic depth variation)
  // ========================================
  
  // Front particles much larger, back particles much smaller
  // Reference image shows prominent sparkles with good size variation
  float baseSize = mix(1.5, 10.0, vDepthFade);
  gl_PointSize = baseSize * (340.0 / particleZ);
  gl_PointSize = clamp(gl_PointSize, 0.8, 24.0);
  
  // ========================================
  // PASS VARYINGS TO FRAGMENT
  // ========================================
  
  vPhase = aPhase;
  vIsWhite = aIsWhite;
  vMorphFade = uMorphFade;
  
  gl_Position = projectionMatrix * mvPos;
}

