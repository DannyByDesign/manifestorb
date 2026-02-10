// Sparkles Vertex Shader (GPU Compute Integration)

precision highp float;

attribute vec2 aUv;
attribute float aPhase;
attribute float aIsWhite;
attribute float aSeed;
attribute float aLayer;
attribute float aSprite;
attribute float aRot;
attribute float aAspect;
attribute float aTwinkle;

uniform float uTime;
uniform float uOrbRadius;
uniform float uMorphFade;
uniform float uPixelRatio;
uniform sampler2D texturePosition;

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

float getLayerSize(float layer, float seed) {
  if (layer < 0.5) {
    // Dust: tiny suspended grains
    return 0.08 + seed * 0.35;
  } else if (layer < 1.5) {
    // Body: small-to-mid grains
    return 0.22 + seed * 1.3;
  }

  // Glint: medium points (bloom handles apparent size)
  return 0.45 + seed * 1.8;
}

float getLayerBrightness(float layer, float seed) {
  if (layer < 0.5) {
    return 0.08 + seed * 0.24;
  } else if (layer < 1.5) {
    return 0.35 + seed * 0.65;
  }

  return 1.3 + seed * 1.4;
}

void main() {
  vec4 posData = texture2D(texturePosition, aUv);
  vec3 particlePos = posData.xyz;
  float life = posData.w;

  vec3 worldPos = particlePos * uOrbRadius;

  float localRadius = length(particlePos);
  vRadialFade = smoothstep(1.0, 0.1, localRadius);

  vec4 mvPos = modelViewMatrix * vec4(worldPos, 1.0);
  float particleZ = max(0.001, -mvPos.z);

  float orbCenterZ = -(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).z;
  float zNear = orbCenterZ - uOrbRadius * 1.25;
  float zFar = orbCenterZ + uOrbRadius * 1.25;

  float rawDepth = 1.0 - smoothstep(zNear, zFar, particleZ);
  vDepthFade = rawDepth * rawDepth;

  float normalizedLife = life > 10.0 ? 1.0 : life;
  float lifeSize = smoothstep(0.0, 0.4, normalizedLife);

  float layerSize = getLayerSize(aLayer, aSeed);
  float depthScale = 120.0 / particleZ;

  gl_PointSize = layerSize * depthScale * lifeSize * uPixelRatio;
  gl_PointSize = clamp(gl_PointSize, 0.0, 28.0);

  vBrightness = getLayerBrightness(aLayer, aSeed);

  vPhase = aPhase;
  vIsWhite = aIsWhite;
  vMorphFade = uMorphFade;
  vLife = normalizedLife;
  vSeed = aSeed;
  vSprite = aSprite;
  vRot = aRot;
  vAspect = aAspect;
  vTwinkle = aTwinkle;
  vLayer = aLayer;

  gl_Position = projectionMatrix * mvPos;
}
