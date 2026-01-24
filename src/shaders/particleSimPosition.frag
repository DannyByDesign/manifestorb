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
    // Generate new random seed based on pixel coord and time
    vec3 spawnSeed = vec3(uv * 1000.0, uTime * 0.1 + seed);
    
    // Spawn in distributed clump near center
    vec3 spawnPos = randomInSphere(spawnSeed) * uSpawnRadius;
    
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
