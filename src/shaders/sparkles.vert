// Sparkles Vertex Shader (GPU Compute Integration)
// Reads particle positions from GPU compute texture

precision highp float;

// ============================================
// Attributes
// ============================================
attribute vec2 aUv;       // UV to sample position texture
attribute float aPhase;   // Random phase for flicker
attribute float aIsWhite; // 1.0 for white accent, 0.0 for base
attribute float aSeed;    // Per-particle seed for variation (0-1)
attribute float aLayer;   // 0=Dust, 1=Body, 2=Glint
attribute float aSprite;  // Sprite index
attribute float aRot;     // Rotation (0..2PI)
attribute float aAspect;  // Aspect ratio
attribute float aTwinkle; // Twinkle offset

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
varying float vSeed;
varying float vSprite;
varying float vRot;
varying float vAspect;
varying float vTwinkle;
varying float vLayer;
varying float vBrightness;

// ============================================
// Layer Logic
// ============================================

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
  
  // Get base size from layer
  float layerSize = getLayerSize(aLayer, aSeed);
  
  // Apply depth scaling (perspective size)
  float depthScale = (200.0 / particleZ);
  
  gl_PointSize = layerSize * depthScale * lifeSize;
  
  // Clamp max size to avoid massive artifacts
  gl_PointSize = clamp(gl_PointSize, 0.0, 64.0);
  
  // ========================================
  // BRIGHTNESS (passed to varying)
  // ========================================
  vBrightness = getLayerBrightness(aLayer, aSeed);
  
  // ========================================
  // PASS VARYINGS
  // ========================================
  
  vPhase = aPhase;
  vIsWhite = aIsWhite;
  vMorphFade = uMorphFade;
  vLife = normalizedLife;  // Pass normalized life (immortal particles clamped to 1.0)
  vSeed = aSeed;           // Per-particle seed for brightness/hue variation
  vSprite = aSprite;
  vRot = aRot;
  vAspect = aAspect;
  vTwinkle = aTwinkle;
  vLayer = aLayer;
  
  gl_Position = projectionMatrix * mvPos;
}
