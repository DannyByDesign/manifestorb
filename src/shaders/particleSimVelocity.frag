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
// Curl Noise (finite differences)
// ============================================

vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);
  
  float n1 = snoise(p + dy);
  float n2 = snoise(p - dy);
  float n3 = snoise(p + dz);
  float n4 = snoise(p - dz);
  float n5 = snoise(p + dx);
  float n6 = snoise(p - dx);
  
  float x = (n1 - n2) - (n3 - n4);
  float y = (n3 - n4) - (n5 - n6);
  float z = (n5 - n6) - (n1 - n2);
  
  return normalize(vec3(x, y, z)) * 0.5;
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
  if (life <= 0.0) {
    // Reset velocity for respawn
    gl_FragColor = vec4(0.0, 0.0, 0.0, seed);
    return;
  }
  
  // ========================================
  // CURL NOISE FORCE (organic swirl)
  // ========================================
  
  vec3 noisePos = pos * 3.0 + uTime * 0.15;
  vec3 curl = curlNoise(noisePos);
  vel += curl * 0.8 * uDeltaTime;
  
  // ========================================
  // RADIAL DRIFT (slight outward fountain effect)
  // ========================================
  
  float dist = length(pos);
  vec3 radial = dist > 0.001 ? normalize(pos) : vec3(0.0, 1.0, 0.0);
  
  // Gentle outward push
  vel += radial * 0.15 * uDeltaTime;
  
  // ========================================
  // CENTER ATTRACTION (keeps particles from escaping)
  // ========================================
  
  float pullStrength = smoothstep(0.3, 0.8, dist / uOrbRadius);
  vel -= radial * pullStrength * 0.3 * uDeltaTime;
  
  // ========================================
  // SPIRAL TENDENCY (adds rotation)
  // ========================================
  
  vec3 tangent = normalize(cross(radial, vec3(0.0, 1.0, 0.0)));
  if (length(tangent) < 0.1) tangent = normalize(cross(radial, vec3(1.0, 0.0, 0.0)));
  vel += tangent * 0.1 * uDeltaTime;
  
  // ========================================
  // HEMISPHERICAL BALANCE (prevents clustering on one side)
  // ========================================
  // Particles on +X get tiny push toward -X, etc.
  // This naturally distributes particles evenly without disrupting fluid motion
  
  float balanceStrength = 0.08;
  vec3 balanceForce = -pos * balanceStrength;  // Push toward opposite side
  vel += balanceForce * uDeltaTime;
  
  // ========================================
  // POINTER VORTEX INJECTION
  // ========================================
  
  if (uPointerLocal.z > -900.0 && uPointerEnergy > 0.01) {
    vec3 toPointer = uPointerLocal - pos;
    float pointerDist = length(toPointer);
    
    if (pointerDist < 0.4 && pointerDist > 0.01) {
      // Tangential swirl around pointer
      vec3 pointerDir = normalize(toPointer);
      vec3 vortexTangent = normalize(cross(pointerDir, vec3(0.0, 1.0, 0.0)));
      if (length(vortexTangent) < 0.1) {
        vortexTangent = normalize(cross(pointerDir, vec3(1.0, 0.0, 0.0)));
      }
      
      float falloff = 1.0 - pointerDist / 0.4;
      falloff = falloff * falloff; // Quadratic falloff
      
      vel += vortexTangent * uPointerEnergy * falloff * 3.0;
    }
  }
  
  // ========================================
  // DAMPING (prevents runaway velocities)
  // ========================================
  
  vel *= 0.96;
  
  // Clamp max velocity
  float speed = length(vel);
  if (speed > 1.5) {
    vel = normalize(vel) * 1.5;
  }
  
  // ========================================
  // OUTPUT
  // ========================================
  
  gl_FragColor = vec4(vel, seed);
}

