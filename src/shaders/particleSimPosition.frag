// Particle Position Simulation Shader
// Updates particle positions and handles lifecycle
// White particles (life > 10) are immortal - they never respawn from center
// Purple particles cycle through birth/death lifecycle

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
// Hash Functions for Randomness
// ============================================

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec3 hash3(vec2 p) {
  vec3 q = vec3(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3)),
    dot(p, vec2(419.2, 371.9))
  );
  return fract(sin(q) * 43758.5453);
}

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

// Random point inside unit sphere
vec3 randomInSphere(vec3 seed) {
  vec3 h = hash3(seed.xy + seed.z);
  float theta = h.x * 6.28318;
  float phi = acos(2.0 * h.y - 1.0);
  float r = pow(h.z, 1.0 / 3.0);
  return vec3(
    r * sin(phi) * cos(theta),
    r * cos(phi),
    r * sin(phi) * sin(theta)
  );
}

// ============================================
// Density Functions
// ============================================

// Multi-band radial probability distribution.
// Emphasizes outer shell while keeping interior layers alive.
float shellPDF(float r) {
  float shellOuter = exp(-pow((r - 0.86) / 0.08, 2.0));
  float shellMid = exp(-pow((r - 0.62) / 0.16, 2.0)) * 0.55;
  float shellCore = exp(-pow((r - 0.36) / 0.20, 2.0)) * 0.22;
  return clamp(shellOuter + shellMid + shellCore, 0.0, 1.0);
}

uniform float uDensityNoiseScale;   // ~0.6
uniform float uDensityContrast;     // ~1.8
uniform vec3 uDensityOffset;        // animated slowly

float clusterDensity(vec3 p) {
  float cluster = 0.5 + 0.5 * snoise(p * uDensityNoiseScale + uDensityOffset);
  cluster = pow(cluster, uDensityContrast); // >1 increases clustering
  return max(cluster, 0.2);
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
  
  // Check if this is an immortal particle (white sparkle)
  // White particles have life initialized to 100.0
  bool isImmortal = life > 10.0;
  
  // ========================================
  // RESPAWN (only for mortal purple particles)
  // ========================================
  
  if (!isImmortal && life <= 0.0) {
    vec3 spawnSeed = vec3(uv * 1000.0, uTime * 0.1 + seed);
    
    // Rejection sampling with shell + cluster
    vec3 spawnPos;
    bool found = false;
    
    // Try to find a good spot based on density map
    for (int attempt = 0; attempt < 8; attempt++) {
      vec3 candidate = randomInSphere(spawnSeed + float(attempt) * 0.1) * 0.95;
      float r = length(candidate);
      float acceptProb = shellPDF(r) * clusterDensity(candidate);
      
      float acceptRand = hash(dot(spawnSeed.xy, vec2(12.9898, 78.233)) + float(attempt));
      if (acceptRand < acceptProb) {
        spawnPos = candidate;
        found = true;
        break;
      }
      spawnPos = candidate; // fallback
    }
    
    // Output respawned position with full life
    gl_FragColor = vec4(spawnPos, 1.0);
    return;
  }
  
  // ========================================
  // POSITION INTEGRATION
  // ========================================
  
  pos += vel * uDeltaTime;
  
  // ========================================
  // BOUNDARY ENFORCEMENT
  // ========================================
  
  float dist = length(pos);
  float maxRadius = 1.0;
  
  if (dist > maxRadius) {
    pos = normalize(pos) * maxRadius;
  }
  
  // ========================================
  // LIFE DECAY (only for mortal particles)
  // ========================================
  
  if (!isImmortal) {
    life -= uLifeDecay * uDeltaTime;
    life = max(life, 0.0);
  }
  // Immortal particles keep their high life value
  
  // ========================================
  // OUTPUT
  // ========================================
  
  gl_FragColor = vec4(pos, life);
}
