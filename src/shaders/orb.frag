// Orb Fragment Shader (Raymarched SDF)
// Glassmorphic shading with shape morphing support
//
// This shader raymarches a signed distance field and applies
// glassmorphic shading. Supports morphing between sphere and
// rounded box for modal transformations.

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

// ============================================
// Noise (simplified for SDF perturbation)
// ============================================

// Hash function for noise
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Simple 3D noise
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
// SDF Primitives (inlined for performance)
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

// Smooth union for organic blending
float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// ============================================
// Scene SDF
// ============================================

float sceneSDF(vec3 p) {
  // Base sphere
  float sphere = sdSphere(p, uSphereRadius);
  
  // Target shape based on uShapeType
  float target = sphere; // default
  
  if (uShapeType == 1) {
    // Rounded box (modal shape)
    target = sdRoundedBox(p, uShapeDimensions, uCornerRadius);
  } else if (uShapeType == 2) {
    // Vertical capsule
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

float raymarch(vec3 ro, vec3 rd) {
  float t = 0.0;
  
  for (int i = 0; i < 128; i++) { // Max iterations (will early exit)
    if (i >= uMaxSteps) break;
    
    vec3 p = ro + rd * t;
    float d = sceneSDF(p);
    
    // Hit surface
    if (d < EPSILON) {
      return t;
    }
    
    // Gone too far
    if (t > MAX_DIST) {
      return -1.0;
    }
    
    t += d;
  }
  
  return -1.0;
}

// ============================================
// Glassmorphic Shading
// ============================================

float fresnel(float cosTheta, float power) {
  return pow(1.0 - cosTheta, power);
}

vec3 shade(vec3 p, vec3 N, vec3 V) {
  vec3 L = normalize(vec3(-1.0, 1.0, 1.0)); // Main light from top-left
  
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  
  // --- 1. Base Glass Body ---
  vec3 color = uBaseColor;
  
  // --- 2. Environment Gradient Mapping ---
  // Diagonal gradient: Cool (Top-Left) to Warm (Bottom-Right)
  float gradientFactor = dot(N, normalize(vec3(1.0, -1.0, 0.0)));
  float t = smoothstep(-0.8, 0.8, gradientFactor);
  vec3 envTint = mix(uCoolColor, uWarmColor, t);
  color = mix(color, envTint, 0.4);
  
  // --- 3. Holographic Sheen (Iridescence) ---
  float iridescent = fresnel(NdotV, 2.5);
  vec3 holoColor = 0.5 + 0.5 * cos(vec3(0.0, 0.33, 0.67) * 6.28 + iridescent * 3.0 + uTime * 0.2);
  color += holoColor * iridescent * 0.15;
  
  // --- 4. Lighting & Highlights ---
  
  // Soft specular
  float spec = pow(NdotL, 8.0);
  color += vec3(1.0) * spec * 0.3;
  
  // Sharp hotspot
  float heavySpec = pow(NdotL, 32.0);
  color += vec3(1.0) * heavySpec * 0.4;
  
  // Rim light
  float rim = fresnel(NdotV, 4.0);
  rim = smoothstep(0.2, 1.0, rim);
  color += uCoolColor * rim * 0.6;
  
  return color;
}

// ============================================
// Ray Generation
// ============================================

vec3 getRayDirection(vec2 uv) {
  // Convert UV (0..1) to NDC (-1..1)
  vec2 ndc = uv * 2.0 - 1.0;
  
  // Create clip-space position (near plane)
  vec4 clipPos = vec4(ndc, -1.0, 1.0);
  
  // Transform to view space
  vec4 viewPos = uInverseProjectionMatrix * clipPos;
  viewPos = vec4(viewPos.xy, -1.0, 0.0); // Direction in view space
  
  // Transform to world space
  vec3 worldDir = (uCameraMatrixWorld * viewPos).xyz;
  
  return normalize(worldDir);
}

// ============================================
// Main
// ============================================

void main() {
  // Generate ray
  vec3 ro = uCameraPos;
  vec3 rd = getRayDirection(vUv);
  
  // Raymarch
  float t = raymarch(ro, rd);
  
  if (t > 0.0) {
    // Hit - calculate shading
    vec3 p = ro + rd * t;
    vec3 N = calcNormal(p);
    vec3 V = -rd; // View direction (opposite of ray)
    
    vec3 color = shade(p, N, V);
    
    gl_FragColor = vec4(color, 1.0);
  } else {
    // Miss - transparent (let background show through)
    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
  }
}

