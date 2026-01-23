// Orb Fragment Shader (Raymarched SDF)
// visionOS-style volumetric glass with refraction
//
// This shader raymarches a signed distance field and renders it as
// a volumetric glass object with proper refraction through front and
// back surfaces. Supports morphing between sphere and rounded box.

precision highp float;

// ============================================
// Uniforms
// ============================================

// Time & Resolution
uniform float uTime;
uniform vec2 uResolution;

// Camera
uniform vec3 uCameraPos;
uniform mat4 uInverseProjectionMatrix;
uniform mat4 uCameraMatrixWorld;

// Shape morphing
uniform int uShapeType;           // 0=sphere, 1=roundedBox, 2=capsule
uniform float uMorphProgress;     // 0..1 blend between shapes
uniform vec3 uShapeDimensions;    // target shape size (half-extents for box)
uniform float uCornerRadius;      // corner radius for rounded shapes
uniform float uSphereRadius;      // base sphere radius

// Surface effects
uniform float uSurfaceNoise;      // displacement amplitude (0 = none)
uniform float uNoiseScale;        // noise frequency
uniform float uNoiseSpeed;        // noise animation speed

// Glass properties
uniform float uIOR;               // Index of refraction (1.45 = glass)
uniform float uGlassTint;         // How much base color tints refraction (0-1)
uniform float uReflectionStrength; // Fresnel reflection intensity (0-1)
uniform float uGlassClarity;      // How clear the glass is (0=frosted, 1=crystal)
uniform int uGlassQuality;        // 0=low (mobile), 1=high (desktop)

// Enhanced glass styling
uniform float uRimIntensity;      // Fresnel edge/rim glow strength (0-1)
uniform float uFrostiness;        // Surface roughness/diffusion (0-1), scatters refracted rays
uniform float uEdgeSaturation;    // Edge saturation/intensity boost (0-1), makes edges richer

// Colors (from CSS variables)
uniform vec3 uBaseColor;
uniform vec3 uCoolColor;
uniform vec3 uWarmColor;

// Quality
uniform int uMaxSteps;            // raymarch iterations (32 mobile, 64 desktop)

// Varyings from vertex shader
varying vec2 vUv;

// ============================================
// Constants
// ============================================

#define PI 3.14159265359
#define MAX_DIST 20.0
#define EPSILON 0.001
#define GLASS_THICKNESS_BIAS 0.02 // Small offset to avoid self-intersection

// ============================================
// Noise (simplified for SDF perturbation)
// ============================================

vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float noise3D(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  
  float n = mix(
    mix(
      mix(dot(hash33(i), f), dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), f.x),
      mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)), dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), f.x),
      f.y
    ),
    mix(
      mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)), dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), f.x),
      mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)), dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), f.x),
      f.y
    ),
    f.z
  );
  return n * 0.5 + 0.5;
}

// ============================================
// SDF Primitives
// ============================================

float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdRoundedBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sdCapsule(vec3 p, float h, float r) {
  p.y -= clamp(p.y, -h * 0.5, h * 0.5);
  return length(p) - r;
}

// ============================================
// Scene SDF
// ============================================

float sceneSDF(vec3 p) {
  // Base sphere
  float sphere = sdSphere(p, uSphereRadius);
  
  // Target shape based on uShapeType
  float target = sphere;
  
  if (uShapeType == 1) {
    target = sdRoundedBox(p, uShapeDimensions, uCornerRadius);
  } else if (uShapeType == 2) {
    target = sdCapsule(p, uShapeDimensions.y * 2.0, uShapeDimensions.x);
  }
  
  // Morph between sphere and target
  float d = mix(sphere, target, uMorphProgress);
  
  // Apply surface noise displacement
  if (uSurfaceNoise > 0.0) {
    float noiseVal = noise3D(p * uNoiseScale + uTime * uNoiseSpeed);
    d += (noiseVal - 0.5) * 2.0 * uSurfaceNoise;
  }
  
  return d;
}

// ============================================
// Normal Calculation
// ============================================

vec3 calcNormal(vec3 p) {
  const float e = 0.0005;
  return normalize(vec3(
    sceneSDF(p + vec3(e, 0, 0)) - sceneSDF(p - vec3(e, 0, 0)),
    sceneSDF(p + vec3(0, e, 0)) - sceneSDF(p - vec3(0, e, 0)),
    sceneSDF(p + vec3(0, 0, e)) - sceneSDF(p - vec3(0, 0, e))
  ));
}

// ============================================
// Raymarching
// ============================================

// Raymarch from outside to find front surface
float raymarchFront(vec3 ro, vec3 rd) {
  float t = 0.0;
  
  for (int i = 0; i < 128; i++) {
    if (i >= uMaxSteps) break;
    
    vec3 p = ro + rd * t;
    float d = sceneSDF(p);
    
    if (d < EPSILON) return t;
    if (t > MAX_DIST) return -1.0;
    
    t += d;
  }
  
  return -1.0;
}

// Raymarch from inside to find back surface
float raymarchBack(vec3 ro, vec3 rd, int maxSteps) {
  float t = 0.0;
  
  for (int i = 0; i < 64; i++) {
    if (i >= maxSteps) break;
    
    vec3 p = ro + rd * t;
    float d = -sceneSDF(p); // Negative because we're inside
    
    if (d < EPSILON) return t;
    if (t > MAX_DIST * 0.5) return -1.0;
    
    // Minimum step size to avoid getting stuck at surface
    t += max(d, 0.01);
  }
  
  return -1.0;
}

// ============================================
// Refraction (Snell's Law)
// ============================================

// eta = n1/n2 (ratio of refractive indices)
vec3 refractRay(vec3 I, vec3 N, float eta) {
  float cosi = dot(-I, N);
  float k = 1.0 - eta * eta * (1.0 - cosi * cosi);
  
  // Total internal reflection
  if (k < 0.0) {
    return reflect(I, N);
  }
  
  return eta * I + (eta * cosi - sqrt(k)) * N;
}

// ============================================
// Fresnel (Schlick approximation)
// ============================================

float fresnelSchlick(float cosTheta, float f0) {
  return f0 + (1.0 - f0) * pow(1.0 - cosTheta, 5.0);
}

// Simplified fresnel for glass (f0 ~ 0.04 for glass)
float glassFresnelTerm(float NdotV) {
  float f0 = 0.04;
  return fresnelSchlick(NdotV, f0);
}

// ============================================
// Frosted Glass - Ray Perturbation
// ============================================

// Perturb a ray direction to simulate frosted/rough glass surface
// Uses noise to scatter the ray slightly, creating diffuse look
vec3 perturbRayFrosted(vec3 dir, vec3 pos, float frostAmount) {
  if (frostAmount <= 0.0) return dir;
  
  // Generate noise-based offset using position for variation
  vec3 noiseOffset = hash33(pos * 10.0 + uTime * 0.1) * 2.0 - 1.0;
  
  // Scale perturbation by frost amount
  // frostAmount of 0.5 gives max ~30 degree scatter
  vec3 perturbedDir = normalize(dir + noiseOffset * frostAmount * 0.5);
  
  return perturbedDir;
}

// ============================================
// Environment / Background Sampling
// ============================================

// Sample environment for reflections (soft gradient)
vec3 sampleEnvironment(vec3 rd) {
  // Create a soft environment gradient based on ray direction
  float upFactor = rd.y * 0.5 + 0.5;
  float rightFactor = rd.x * 0.5 + 0.5;
  
  // Soft sky-like gradient
  vec3 skyColor = mix(uCoolColor, vec3(1.0), upFactor * 0.3);
  vec3 groundColor = mix(uWarmColor, uBaseColor, 0.5);
  
  vec3 env = mix(groundColor, skyColor, smoothstep(0.3, 0.7, upFactor));
  
  // Add subtle variation
  env += (rightFactor - 0.5) * 0.05 * uWarmColor;
  
  return env;
}

// Sample background through refraction (CSS gradient approximation)
vec3 sampleBackground(vec3 rd, vec2 screenUv) {
  // Use refracted ray direction to offset UV sampling
  vec2 bgUv = screenUv + rd.xy * 0.1;
  bgUv = clamp(bgUv, 0.0, 1.0);
  
  // Recreate the CSS gradient (lilac base with warm/cool regions)
  // This approximates the layered radial gradients from globals.css
  
  // Base lilac
  vec3 bgColor = uBaseColor * 0.95;
  
  // Cool region (top-left, bottom-left)
  float coolRegion = smoothstep(0.7, 0.3, bgUv.x) * smoothstep(0.3, 0.7, bgUv.y);
  coolRegion += smoothstep(0.7, 0.3, bgUv.x) * smoothstep(0.7, 0.3, bgUv.y) * 0.5;
  bgColor = mix(bgColor, uCoolColor * 0.9, coolRegion * 0.4);
  
  // Warm region (bottom-right)
  float warmRegion = smoothstep(0.4, 0.8, bgUv.x) * smoothstep(0.6, 0.2, bgUv.y);
  bgColor = mix(bgColor, uWarmColor, warmRegion * 0.5);
  
  // Light wash (top area)
  float lightWash = smoothstep(0.5, 0.9, bgUv.y);
  bgColor = mix(bgColor, vec3(0.98, 0.97, 0.99), lightWash * 0.3);
  
  return bgColor;
}

// ============================================
// Volumetric Glass Shading
// ============================================

vec4 shadeGlass(vec3 frontHitPos, vec3 frontNormal, vec3 rayDir, vec2 screenUv) {
  vec3 V = -rayDir;
  float NdotV = max(dot(frontNormal, V), 0.0);
  
  // --- Fresnel term ---
  float fresnel = glassFresnelTerm(NdotV);
  fresnel *= uReflectionStrength;
  
  // --- Reflection component ---
  vec3 reflectDir = reflect(rayDir, frontNormal);
  vec3 reflection = sampleEnvironment(reflectDir);
  
  // Add soft specular highlight
  vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
  float specAngle = max(dot(reflectDir, lightDir), 0.0);
  float specular = pow(specAngle, 64.0) * 0.4;
  reflection += vec3(1.0) * specular;
  
  // --- Refraction component ---
  float eta = 1.0 / uIOR; // Air to glass
  vec3 refractDir = refractRay(rayDir, frontNormal, eta);
  
  // Apply frosted glass effect - MORE frost in center, LESS at edges
  // This keeps edges crisp/saturated while center is soft/diffuse
  float centerFrost = pow(NdotV, 0.7); // Higher in center (NdotV~1), lower at edges (NdotV~0)
  float frostAmount = uFrostiness * (0.3 + centerFrost * 1.2); // Base frost + center boost
  refractDir = perturbRayFrosted(refractDir, frontHitPos, frostAmount);
  
  vec3 refractedColor;
  
  // High quality: trace through volume
  if (uGlassQuality > 0) {
    // Step inside the glass slightly
    vec3 insidePos = frontHitPos + refractDir * GLASS_THICKNESS_BIAS;
    
    // Find back surface
    int backSteps = uGlassQuality > 0 ? 32 : 16;
    float backDist = raymarchBack(insidePos, refractDir, backSteps);
    
    if (backDist > 0.0) {
      // Hit back surface
      vec3 backPos = insidePos + refractDir * backDist;
      vec3 backNormal = -calcNormal(backPos); // Inward-facing normal
      
      // Refract again exiting glass
      vec3 exitDir = refractRay(refractDir, backNormal, uIOR);
      
      // Apply frosted effect to exit ray - also center-weighted
      exitDir = perturbRayFrosted(exitDir, backPos, frostAmount * 0.5);
      
      // Sample background with exit direction
      refractedColor = sampleBackground(exitDir, screenUv);
      
      // Add depth-based absorption (thicker = more tinted)
      float thickness = backDist;
      float absorption = 1.0 - exp(-thickness * 0.5);
      refractedColor = mix(refractedColor, uBaseColor * 0.9, absorption * uGlassTint);
      
    } else {
      // Didn't find back surface (edge case)
      refractedColor = sampleBackground(refractDir, screenUv);
    }
  } else {
    // Low quality: single refraction (mobile fallback)
    refractedColor = sampleBackground(refractDir, screenUv);
    refractedColor = mix(refractedColor, uBaseColor * 0.9, uGlassTint * 0.5);
  }
  
  // --- Edge saturation boost (on BACKGROUND color seen through glass) ---
  // At grazing angles, intensify the refracted background color
  // This makes the background "pop" more at edges without hardcoding colors
  float edgeFactor = smoothstep(0.35, 0.85, 1.0 - NdotV);
  float bgSaturationBoost = 1.0 + edgeFactor * uEdgeSaturation;
  refractedColor *= bgSaturationBoost;
  
  // --- Blend reflection and refraction ---
  vec3 glassColor = mix(refractedColor, reflection, fresnel);
  
  // --- Enhanced rim glow (visionOS style) ---
  // Primary rim: sharp edge highlight (higher power = tighter to edge)
  float rimSharp = pow(1.0 - NdotV, 7.0);
  // Secondary rim: softer falloff for subtle gradation
  float rimSoft = pow(1.0 - NdotV, 3.5);
  
  // Combine both rims with intensity control
  float rimGlow = mix(rimSoft * 0.25, rimSharp, 0.75) * uRimIntensity;
  
  // Rim color: blend between cool color and white for the highlight
  vec3 rimColor = mix(uCoolColor, vec3(1.0), rimSharp * 0.5);
  glassColor += rimColor * rimGlow * 0.85;
  
  // --- Soft inner glow / subsurface hint ---
  // Center gets slightly lighter/softer
  float centerFactor = pow(NdotV, 1.5);
  float innerGlow = centerFactor * 0.1;
  glassColor = mix(glassColor, glassColor + vec3(0.08), innerGlow);
  
  // --- Alpha: more opaque at edges (fresnel), more transparent in center ---
  // visionOS glass is quite transparent in the center
  float alpha = mix(0.15, 0.85, fresnel);
  alpha = mix(alpha, 1.0, specular); // Specular highlights are opaque
  
  // Increase opacity at edges so the saturated background shows more
  alpha = mix(alpha, min(alpha + 0.25, 1.0), edgeFactor * uEdgeSaturation);
  
  return vec4(glassColor, alpha);
}

// ============================================
// Ray Generation
// ============================================

vec3 getRayDirection(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  vec4 clipPos = vec4(ndc, -1.0, 1.0);
  vec4 viewPos = uInverseProjectionMatrix * clipPos;
  viewPos = vec4(viewPos.xy, -1.0, 0.0);
  vec3 worldDir = (uCameraMatrixWorld * viewPos).xyz;
  return normalize(worldDir);
}

// ============================================
// Main
// ============================================

void main() {
  vec3 ro = uCameraPos;
  vec3 rd = getRayDirection(vUv);
  
  // Raymarch to front surface
  float t = raymarchFront(ro, rd);
  
  if (t > 0.0) {
    // Hit glass surface
    vec3 hitPos = ro + rd * t;
    vec3 normal = calcNormal(hitPos);
    
    // Render volumetric glass
    vec4 glassColor = shadeGlass(hitPos, normal, rd, vUv);
    
    gl_FragColor = glassColor;
  } else {
    // Miss - fully transparent
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
}
