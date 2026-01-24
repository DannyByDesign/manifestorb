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

// New Advection Uniforms
uniform float uFlowScale;
uniform float uGlobalRotationSpeed;
uniform float uVortexStrength;
uniform vec3 uVortex0;
uniform vec3 uVortex1;
uniform float uFollowStrength;
uniform float uDrag;
uniform float uBoundaryPull;
uniform float uMaxSpeed;

// ============================================
// Simplex Noise (3D)
// ============================================

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x*34.0)+1.0)*x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
  const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i  = floor(v + dot(v, C.yyy) );
  vec3 x0 = v - i + dot(i, C.xxx) ;

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min( g.xyz, l.zxy );
  vec3 i2 = max( g.xyz, l.zxy );

  //   x0 = x0 - 0.0 + 0.0 * C.xxx;
  //   x1 = x0 - i1  + 1.0 * C.xxx;
  //   x2 = x0 - i2  + 2.0 * C.xxx;
  //   x3 = x0 - 1.0 + 3.0 * C.xxx;
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
  vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y

  // Permutations
  i = mod289(i); 
  vec4 p = permute( permute( permute( 
             i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
           + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
  float n_ = 0.142857142857; // 1.0/7.0
  vec3  ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)

  vec4 x = x_ *ns.x + ns.yyyy;
  vec4 y = y_ *ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4( x.xy, y.xy );
  vec4 b1 = vec4( x.zw, y.zw );

  //vec4 s0 = vec4(lessThan(b0,0.0))*2.0 - 1.0;
  //vec4 s1 = vec4(lessThan(b1,0.0))*2.0 - 1.0;
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

  vec3 p0 = vec3(a0.xy,h.x);
  vec3 p1 = vec3(a0.zw,h.y);
  vec3 p2 = vec3(a1.xy,h.z);
  vec3 p3 = vec3(a1.zw,h.w);

  //Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Mix final noise value
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                dot(p2,x2), dot(p3,x3) ) );
}

// ============================================
// Curl & Warp Functions
// ============================================

vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float n_x = snoise(p + dx);
  float n_X = snoise(p - dx);
  float n_y = snoise(p + dy);
  float n_Y = snoise(p - dy);
  float n_z = snoise(p + dz);
  float n_Z = snoise(p - dz);

  float dfdy = n_y - n_Y;
  float dfdz = n_z - n_Z;
  float dfdx = n_x - n_X;

  // We actually need 3 independent noise fields for true curl, 
  // but a single field curl like (dy - dz, dz - dx, dx - dy) is a decent cheap approx
  // Let's stick to the better version from before if performance allows, 
  // or use the cheap one if we want speed.
  // The cheap single-field approx:
  return normalize(vec3(
    (snoise(p + dy) - snoise(p - dy)) - (snoise(p + dz) - snoise(p - dz)),
    (snoise(p + dz) - snoise(p - dz)) - (snoise(p + dx) - snoise(p - dx)),
    (snoise(p + dx) - snoise(p - dx)) - (snoise(p + dy) - snoise(p - dy))
  ));
}

// Offset coordinates for localized warping
vec3 domainWarp(vec3 p) {
  float n = snoise(p * 1.5 + uTime * 0.1);
  return vec3(n * 0.5);
}

// ============================================
// Integration Logic
// ============================================

vec3 baseFlowField(vec3 p) {
  vec3 warped = p * 0.7 + domainWarp(p);
  return curlNoise(warped * uFlowScale + uTime * 0.1);
}

vec3 galaxyRotation(vec3 p) {
  // Tangential vector around Y axis
  vec3 tang = normalize(vec3(-p.z, 0.0, p.x));
  
  // Shell Gain: limit rotation to middle shell (peak 0.4, zero at center/edge)
  float r = length(p);
  float gain = smoothstep(0.0, 0.4, r) * (1.0 - smoothstep(0.7, 1.2, r));
  
  return tang * uGlobalRotationSpeed * gain;
}

vec3 vortexInfluence(vec3 p, vec3 center) {
  vec3 diff = p - center;
  float d = length(diff);
  vec3 tang = normalize(cross(diff, vec3(0.0, 1.0, 0.0))); // Rough axis
  
  // Gaussian falloff
  float effect = exp(-d * d * 4.0);
  return tang * uVortexStrength * effect;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 posData = texture2D(texturePosition, uv);
  vec4 velData = texture2D(textureVelocity, uv);
  
  vec3 pos = posData.xyz;
  float life = posData.w;
  vec3 vel = velData.xyz;
  float seed = velData.w;
  
  // Layer logic via seed
  // Matches Sparkles.tsx: <0.45 Dust, <0.93 Body, >0.93 Glint
  float seedNorm = fract(seed); // Assuming seed is large random
  // Actually seed in texture is initialized as Math.random() + (white?10:0)
  // so fract(seed) works for 0..1 distribution
  
  float followFactor = 1.0;
  float layer = 0.0; // 0=Dust, 1=Body, 2=Glint
  
  // This logic must roughly match the "layers" attribute distribution
  // Since we don't pass layer map to compute shader, we infer from random
  // Note: This is an approximation since JS Math.random and Shader hash differ.
  // But for chaos it is fine.
  
  if (seedNorm < 0.45) {
     // Dust: High follow (suspended)
     followFactor = 1.8;
  } else if (seedNorm < 0.93) {
     // Body: Medium follow
     followFactor = 1.0;
  } else {
     // Glint: Low follow (momentum)
     followFactor = 0.5;
  }
  
  if (life <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, seed);
    return;
  }
  
  // ==========================
  // COMPUTE FORCES
  // ==========================
  
  vec3 targetVel = vec3(0.0);
  
  // 1. Base Curl Flow
  targetVel += baseFlowField(pos);
  
  // 2. Galaxy Rotation
  targetVel += galaxyRotation(pos);
  
  // 3. Wandering Vortexes
  targetVel += vortexInfluence(pos, uVortex0);
  targetVel += vortexInfluence(pos, uVortex1);
  
  // 4. Pointer Swirl
  if (uPointerLocal.z > -900.0 && uPointerEnergy > 0.01) {
      vec3 toPointer = pos - uPointerLocal;
      float d = length(toPointer);
      vec3 pTan = normalize(cross(toPointer, vec3(0.0, 0.0, 1.0))); 
      float pEffect = exp(-d*d*6.0) * uPointerEnergy;
      targetVel += pTan * pEffect * 8.0;
      targetVel += normalize(toPointer) * -pEffect * 2.0; // Attraction
  }
  
  // ==========================
  // PAUSE / MICRO-BEHAVIOR
  // ==========================
  
  // Use noise to trigger occasional pauses
  // Dust (layer < 0.45, seed < 0.45) pauses more often
  float pauseNoise = snoise(vec3(seed * 10.0, uTime * 0.5, 0.0));
  float pauseThreshold = (seedNorm < 0.45) ? 0.6 : 0.85; // Dust pauses easily, glints rarely
  
  if (pauseNoise > pauseThreshold) {
     // Enter "suspended" state - drift very slowly
     targetVel *= 0.05;
     followFactor = 5.0; // Strong lock to this low velocity (stops momentum)
  }
  
  // ==========================
  // APPLY ADVECTION
  // ==========================
  
  // Inertial blend: mix current vel towards target vel
  // uFollowStrength (0..1) controls how "fluid" vs "ballistic"
  float blend = uFollowStrength * followFactor * 10.0 * uDeltaTime;
  blend = clamp(blend, 0.0, 1.0);
  
  vel = mix(vel, targetVel, blend);
  
  // ==========================
  // CONSTRAINTS
  // ==========================
  
  // Drag
  vel *= (1.0 - uDrag);
  
  // Soft Boundary Pull (keep in orb)
  float r = length(pos);
  if (r > 0.88) {
    float push = (r - 0.88) * uBoundaryPull;
    vel -= normalize(pos) * push;
  }
  
  // Speed Limit
  float speed = length(vel);
  if (speed > uMaxSpeed) {
    vel = normalize(vel) * uMaxSpeed;
  }
  
  gl_FragColor = vec4(vel, seed);
}

