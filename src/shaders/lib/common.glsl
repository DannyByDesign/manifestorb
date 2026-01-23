// Common shader utilities and uniform declarations
// Include this in shaders that need shared functionality

// ============================================
// Constants
// ============================================
#define PI 3.14159265359
#define TWO_PI 6.28318530718
#define HALF_PI 1.57079632679

// ============================================
// Math Utilities
// ============================================

// Clamp to [0, 1]
float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

vec2 saturate(vec2 x) {
  return clamp(x, 0.0, 1.0);
}

vec3 saturate(vec3 x) {
  return clamp(x, 0.0, 1.0);
}

// Remap value from one range to another
float remap(float value, float inMin, float inMax, float outMin, float outMax) {
  return outMin + (value - inMin) * (outMax - outMin) / (inMax - inMin);
}

// Smooth minimum (useful for metaballs/SDF blending)
float smin(float a, float b, float k) {
  float h = saturate(0.5 + 0.5 * (b - a) / k);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Fresnel approximation (Schlick)
float fresnel(float cosTheta, float power) {
  return pow(1.0 - cosTheta, power);
}

// ============================================
// Color Utilities  
// ============================================

// HSL to RGB conversion
vec3 hsl2rgb(vec3 hsl) {
  vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
}

// ============================================
// Uniform Declarations (copy to your shader)
// ============================================
// These are declared as comments to be copied, not auto-included
// since GLSL doesn't have a proper include system

/*
// Time & Resolution
uniform float uTime;
uniform vec2 uResolution;

// Pointer Interaction
uniform vec2 uPointer;      // normalized UV [0,1]
uniform vec2 uPointerVel;   // velocity per frame
uniform float uCursorEnergy; // clamp(length(pointerVel) * gain, 0, 1)

// Audio Reactivity
uniform float uAudioLevel;  // 0..1 smoothed RMS
uniform float uBass;        // 0..1 low frequencies
uniform float uMid;         // 0..1 mid frequencies  
uniform float uTreble;      // 0..1 high frequencies
*/
