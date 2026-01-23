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

// Surface effects (legacy - kept for backward compatibility)
uniform float uSurfaceNoise;      // displacement amplitude (0 = none) [DEPRECATED]
uniform float uNoiseScale;        // noise frequency [DEPRECATED]
uniform float uNoiseSpeed;        // noise animation speed

// Enhanced displacement system
uniform float uDisplacementAmp;   // overall displacement strength (0.0-0.2)
uniform int uNoiseOctaves;         // FBM octave count (1-4)
uniform float uNoiseFrequency;    // base frequency multiplier (1.0-5.0)
uniform float uNoiseLacunarity;   // frequency multiplier per octave (1.5-2.5)
uniform float uNoisePersistence;   // amplitude decay per octave (0.3-0.7)

// Flow-based animation
uniform float uFlowStrength;      // how much curl noise affects position (0.0-0.5)
uniform float uFlowSpeed;         // animation speed of flow field (0.1-1.0)
uniform float uFlowScale;          // spatial scale of flow field (0.5-3.0)
uniform int uEnableFlow;           // flow toggle (0=disabled, 1=enabled)

// Audio-reactive (prep for Phase 4)
uniform float uAudioLevel;         // overall audio amplitude (0.0-1.0)
uniform float uAudioBass;          // low frequency band (0.0-1.0)
uniform float uAudioMid;           // mid frequency band (0.0-1.0)
uniform float uAudioTreble;        // high frequency band (0.0-1.0)

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
// Noise Library (Simplex Noise)
// ============================================
// 3D Simplex Noise by Ian McEwan, Stefan Gustavson
// Optimized for GLSL ES 3.0 (WebGL2)

// Hash function for random vec3 (used by perturbRayFrosted)
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

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

// Convenience: remap to [0, 1]
float snoise01(vec3 v) {
  return snoise(v) * 0.5 + 0.5;
}

// Fractal Brownian Motion
float fbm3(vec3 p, int octaves) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  
  for (int i = 0; i < octaves; i++) {
    value += amplitude * snoise(p * frequency);
    frequency *= 2.0;
    amplitude *= 0.5;
  }
  
  return value;
}

// Curl noise helper - compute curl of 3D noise field
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
  
  // Use offset samples for different components
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
// Surface Displacement
// ============================================

// Audio-reactive displacement modifier
float audioDisplacementMod() {
  float mod = 1.0;
  mod += uAudioLevel * 2.0;  // Audio doubles displacement
  mod += uAudioBass * 1.5;    // Bass adds extra punch
  return mod;
}

// Multi-octave FBM displacement with flow
float surfaceDisplacement(vec3 p) {
  // Apply flow-based position offset (curl noise for organic movement)
  vec3 offsetP = p;
  if (uEnableFlow > 0) {
    vec3 flowP = p * uFlowScale + uTime * uFlowSpeed;
    vec3 flow = curlNoise(flowP);
    offsetP = p + flow * uFlowStrength;
  }
  
  // Calculate dynamic frequency (treble adds detail)
  float dynamicFreq = uNoiseFrequency * (1.0 + uAudioTreble * 0.5);
  
  // FBM multi-octave noise
  float value = 0.0;
  float amplitude = 1.0;
  float frequency = dynamicFreq;
  
  // Clamp octaves to prevent shader loop issues
  int maxOctaves = min(uNoiseOctaves, 4);
  
  for (int i = 0; i < 4; i++) {
    if (i >= maxOctaves) break;
    
    vec3 noiseP = offsetP * frequency + uTime * uNoiseSpeed;
    value += amplitude * snoise(noiseP);
    
    frequency *= uNoiseLacunarity;
    amplitude *= uNoisePersistence;
  }
  
  // Apply audio-reactive modifier
  float audioMod = audioDisplacementMod();
  
  return value * uDisplacementAmp * audioMod;
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
  
  // Apply enhanced surface displacement
  if (uDisplacementAmp > 0.0) {
    d += surfaceDisplacement(p);
  }
  
  // Legacy displacement support (for backward compatibility)
  if (uSurfaceNoise > 0.0 && uDisplacementAmp <= 0.0) {
    float noiseVal = snoise01(p * uNoiseScale + uTime * uNoiseSpeed);
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
