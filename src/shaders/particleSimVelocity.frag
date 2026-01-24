// Particle Velocity Simulation Shader
// Applies forces: curl noise, radial drift, center attraction, pointer vortex

precision highp float;

// ============================================
// Uniforms
// ============================================
uniform float uTime;
uniform float uDeltaTime;
uniform float uOrbRadius;
uniform vec3 uPointerLocal;
uniform float uPointerEnergy;
uniform float uSpawnRadius;
uniform float uLifeDecay;

// ============================================
// Simplex Noise (inlined)
// ============================================

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

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
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

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

// ============================================
// Curl Noise (proper 3-field implementation)
// Uses three independent noise fields to avoid diagonal bias
// ============================================

vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  
  // Three independent noise fields (offset creates different patterns)
  vec3 offsetY = vec3(31.416, 47.853, 12.793);
  vec3 offsetZ = vec3(93.719, 27.364, 81.252);
  
  // Sample derivatives for field X (original position)
  float dXdy = snoise(p + vec3(0.0, e, 0.0)) - snoise(p - vec3(0.0, e, 0.0));
  float dXdz = snoise(p + vec3(0.0, 0.0, e)) - snoise(p - vec3(0.0, 0.0, e));
  
  // Sample derivatives for field Y (offset position)
  float dYdx = snoise(p + offsetY + vec3(e, 0.0, 0.0)) - snoise(p + offsetY - vec3(e, 0.0, 0.0));
  float dYdz = snoise(p + offsetY + vec3(0.0, 0.0, e)) - snoise(p + offsetY - vec3(0.0, 0.0, e));
  
  // Sample derivatives for field Z (different offset)
  float dZdx = snoise(p + offsetZ + vec3(e, 0.0, 0.0)) - snoise(p + offsetZ - vec3(e, 0.0, 0.0));
  float dZdy = snoise(p + offsetZ + vec3(0.0, e, 0.0)) - snoise(p + offsetZ - vec3(0.0, e, 0.0));
  
  // Proper curl: (dPz/dy - dPy/dz, dPx/dz - dPz/dx, dPy/dx - dPx/dy)
  vec3 curl = vec3(
    dZdy - dYdz,
    dXdz - dZdx,
    dYdx - dXdy
  );
  
  return normalize(curl + vec3(0.0001)) * 0.5;
}

// ============================================
// Main
// ============================================

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  
  // Sample current state
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);
  
  vec3 pos = posData.xyz;
  float life = posData.w;
  vec3 vel = velData.xyz;
  float seed = velData.w;
  
  // Skip if dead (will be respawned in position shader)
  // Give initial outward velocity to shoot out from center in ALL directions
  if (life <= 0.0) {
    // Generate random direction using time + seed + uv for true randomness each respawn
    float randA = fract(sin(dot(uv + uTime * 0.1, vec2(12.9898, 78.233))) * 43758.5453);
    float randB = fract(sin(dot(uv * 2.0 + uTime * 0.17, vec2(39.346, 11.135))) * 43758.5453);
    
    // Uniform sphere distribution
    float theta = randA * 6.28318;  // 0 to 2π
    float phi = acos(2.0 * randB - 1.0);  // Uniform on sphere
    vec3 randomDir = vec3(
      sin(phi) * cos(theta),
      cos(phi),
      sin(phi) * sin(theta)
    );
    // Initial outward velocity
    vec3 initialVel = randomDir * 0.3;
    gl_FragColor = vec4(initialVel, seed);
    return;
  }
  
  // ========================================
  // PER-PARTICLE VARIATION (from seed)
  // ========================================
  
  float seedNorm = fract(seed);
  float speedMult = 0.7 + seedNorm * 0.6;  // 0.7x to 1.3x speed variation
  
  // White particles (seed > 10) get extra phase offset to spread them out
  bool isWhite = seed > 10.0;
  float phaseOffset = isWhite ? fract(seed * 0.1) * 6.28 : 0.0;
  
  // ========================================
  // GEOMETRY
  // ========================================
  
  float dist = length(pos);
  float xzDist = length(pos.xz);
  vec3 radial = dist > 0.001 ? pos / dist : vec3(0.0, 1.0, 0.0);
  
  // ========================================
  // VERY LOW-FREQUENCY CURL NOISE (fluid-like coherent streams)
  // Lower frequency = nearby particles get nearly identical forces
  // ========================================
  
  // Very low frequency = particles flow together in streams
  vec3 noiseOffset = isWhite ? vec3(sin(phaseOffset), cos(phaseOffset), sin(phaseOffset * 0.7)) * 0.3 : vec3(0.0);
  vec3 noisePos = pos * 0.4 + uTime * 0.12 + noiseOffset;  // Lower freq, slower evolution
  vec3 curl = curlNoise(noisePos);
  
  // Strong curl force - creates fluid 3D motion
  vel += curl * 2.5 * speedMult * uDeltaTime;
  
  // ========================================
  // RADIAL SPREAD (fill volume)
  // ========================================
  
  // Very gentle outward push
  vel += radial * 0.03 * uDeltaTime;
  
  // ========================================
  // CENTER ATTRACTION (keep particles contained)
  // Balanced to contain but not compress
  // ========================================
  
  float pullStrength = smoothstep(0.35, 0.75, dist);
  vel -= radial * pullStrength * 0.6 * uDeltaTime;
  
  // ========================================
  // HARD BOUNDARY ENFORCEMENT
  // Strongly push particles back if they approach edge
  // ========================================
  
  if (dist > 0.7) {
    float overflow = (dist - 0.7) / 0.3;  // 0 at 0.7, 1 at 1.0
    vel -= radial * overflow * 1.5 * uDeltaTime;  // Strong inward push
  }
  
  // ========================================
  // POINTER VORTEX INJECTION
  // ========================================
  
  if (uPointerLocal.z > -900.0 && uPointerEnergy > 0.01) {
    vec3 toPointer = uPointerLocal - pos;
    float pointerDist = length(toPointer);
    
    if (pointerDist < 0.5 && pointerDist > 0.01) {
      vec3 pointerDir = normalize(toPointer);
      vec3 vortexTangent = normalize(cross(pointerDir, vec3(0.0, 1.0, 0.0)));
      if (length(vortexTangent) < 0.1) {
        vortexTangent = normalize(cross(pointerDir, vec3(1.0, 0.0, 0.0)));
      }
      
      float falloff = 1.0 - pointerDist / 0.5;
      falloff = falloff * falloff;
      
      vel += vortexTangent * uPointerEnergy * falloff * 2.5;
    }
  }
  
  // ========================================
  // DAMPING (very low for fluid-like inertia)
  // ========================================
  
  vel *= 0.992;  // High momentum = smooth flowing motion
  
  // Clamp max velocity (high cap for fast motion)
  float speed = length(vel);
  if (speed > 3.5) {
    vel = normalize(vel) * 3.5;
  }
  
  // ========================================
  // OUTPUT
  // ========================================
  
  gl_FragColor = vec4(vel, seed);
}

