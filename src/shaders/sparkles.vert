// Sparkles Vertex Shader (GPU Compute Integration)
// Reads particle positions from GPU compute texture

precision highp float;

// ============================================
// Attributes
// ============================================
attribute vec2 aUv;       // UV to sample position texture
attribute float aPhase;   // Random phase for flicker
attribute float aIsWhite; // 1.0 for white accent, 0.0 for base

// ============================================
// Uniforms
// ============================================
uniform float uTime;
uniform float uOrbRadius;
uniform float uMorphFade;
uniform sampler2D texturePosition;  // GPU compute position texture (xyz = pos, w = life)

// ============================================
// Varyings
// ============================================
varying float vDepthFade;
varying float vRadialFade;
varying float vPhase;
varying float vIsWhite;
varying float vMorphFade;
varying float vLife;

void main() {
  // ========================================
  // SAMPLE POSITION FROM GPU COMPUTE TEXTURE
  // ========================================
  
  vec4 posData = texture2D(texturePosition, aUv);
  vec3 particlePos = posData.xyz;
  float life = posData.w;
  
  // Scale to orb radius
  vec3 worldPos = particlePos * uOrbRadius;
  
  // ========================================
  // RADIAL FADE (halo effect at edges)
  // ========================================
  
  float localRadius = length(particlePos);
  vRadialFade = 1.0 - smoothstep(0.75, 1.0, localRadius);
  
  // ========================================
  // VIEW SPACE TRANSFORM
  // ========================================
  
  vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
  float particleZ = -mvPos.z;
  
  // ========================================
  // DEPTH FADE (front = bright, back = dim)
  // ========================================
  
  float orbCenterZ = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  float zNear = orbCenterZ - uOrbRadius * 1.2;
  float zFar = orbCenterZ + uOrbRadius * 1.2;
  
  float rawDepth = 1.0 - smoothstep(zNear, zFar, particleZ);
  vDepthFade = rawDepth * rawDepth;
  
  // ========================================
  // POINT SIZE (life-based + depth-based)
  // ========================================
  
  // Normalize life for rendering (immortal particles have life > 10)
  float normalizedLife = life > 10.0 ? 1.0 : life;
  
  // Life affects size (shrink as particle ages/dies)
  float lifeSize = smoothstep(0.0, 0.3, normalizedLife);
  
  // Base size with depth variation
  float baseSize = mix(0.8, 4.0, vDepthFade) * lifeSize;
  
  // Independent sizing for purple vs white sparkles
  float purpleSize = clamp(baseSize * (200.0 / particleZ), 0.5, 10.0);
  float whiteSize = clamp(baseSize * 2.5 * (200.0 / particleZ), 1.0, 25.0);
  
  gl_PointSize = mix(purpleSize, whiteSize, aIsWhite);
  
  // ========================================
  // PASS VARYINGS
  // ========================================
  
  vPhase = aPhase;
  vIsWhite = aIsWhite;
  vMorphFade = uMorphFade;
  vLife = normalizedLife;  // Pass normalized life (immortal particles clamped to 1.0)
  
  gl_Position = projectionMatrix * mvPos;
}
