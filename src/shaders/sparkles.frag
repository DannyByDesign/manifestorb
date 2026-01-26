// Sparkles Fragment Shader
// 3D sphere-shaded particles with life-based fading

precision highp float;

// ============================================
// Uniforms
// ============================================
uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uGlowColor;



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
varying float vBrightness;
varying float vTwinkle;
varying float vLayer;

// ============================================
// Utils
// ============================================

// Rotate 2D point
vec2 rot2(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Hash function for dither
float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  // ========================================
  // SPRITE UV TRANSFORM (Simplified)
  // ========================================
  
  vec2 uv = gl_PointCoord - 0.5;
  // Previously we rotated UVs and clipped results, causing square artifacts.
  // For spherical particles, rotation is irrelevant for the shape itself.
  // We keep aspect ratio if needed, but for "grains" we want roundness.
  // Let's stick to simple circular UVs for the imposter sphere.
  
  float dist = length(uv) * 2.0; // 0..1 from center
  
  // Early discard for circle
  if (dist > 1.0) discard;
  
  // ========================================
  // IMPOSTER SPHERE SHADING
  // ========================================

  // Calculate fake normal from 2D UV
  // N.z is the "height" of the sphere at this point
  float z = sqrt(1.0 - dist * dist);
  vec3 normal = normalize(vec3(uv * 2.0, z));
  
  // Lighting Setup
  // Light coming from Top-Left-Front (matches orb lighting)
  vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
  
  // Diffuse Lighting (Lambert)
  float diffuse = max(dot(normal, lightDir), 0.0);
  
  // Ambient Light (so shadow side isn't pitch black)
  float ambient = 0.4;
  
  // Specular Highlight (Flash)
  vec3 viewDir = vec3(0.0, 0.0, 1.0); // Orthographic approximation for sprite
  vec3 halfVec = normalize(lightDir + viewDir);
  float rnd = 32.0; // Roughness/Glossiness
  float specular = pow(max(dot(normal, halfVec), 0.0), rnd);
  
  // ========================================
  // SHAPE & COLOR
  // ========================================

  float alpha = 1.0;
  
  // Base Particle Appearance
  vec3 baseCol = uBaseColor;
  
  // Variation Tints
  vec3 warmTint = vec3(1.0, 0.92, 0.95);
  vec3 coolTint = vec3(0.92, 0.95, 1.0);
  vec3 hueTint = mix(coolTint, warmTint, vSeed);
  
  baseCol *= hueTint;

  // Apply Shading to Color
  vec3 litColor = baseCol * (diffuse * 0.8 + ambient);
  
  // Add Specular (white hot)
  litColor += vec3(1.0) * specular * 0.6; // 60% intensity specular
  
  // Handle "Glint" vs "Dust" via Layer
  // Glint (Layer 2) = Emissive / Unlit? Or just brighter?
  if (vLayer > 1.5) {
     // Glint: Ignore shading, just glow
     // Use texture-like soft glow pattern
     float glow = exp(-dist * dist * 8.0);
     litColor = mix(uGlowColor, vec3(1.0), glow * 0.5);
     litColor *= 1.5; // Boost brightness
     alpha = glow; // Soft edge
  } else {
     // Body/Dust: Solid Imposter Sphere
     // Soften edge slightly for anti-aliasing
     alpha = smoothstep(1.0, 0.85, dist);
  }
  
  // ========================================
  // FLICKER / TWINKLE
  // ========================================
  
  float speed = (vLayer < 0.5) ? 0.5 : (vLayer < 1.5) ? 2.0 : 6.0;
  float amp = (vLayer < 0.5) ? 0.05 : (vLayer < 1.5) ? 0.15 : 0.4;
  float flicker = 1.0 - amp + amp * sin(uTime * speed + vTwinkle * 6.28 + vPhase * 3.0);
  
  litColor *= flicker;
  
  // Brightness Mult from Vertex
  litColor *= vBrightness;

  // ========================================
  // ALPHA FADES
  // ========================================
  
  float lifeAlpha = smoothstep(0.0, 0.2, vLife);
  alpha *= vDepthFade * vRadialFade * vMorphFade * lifeAlpha;

  // Ensure alpha isn't too low for normal blending to register
  // But also can use it for semi-transparent edge
  
  gl_FragColor = vec4(litColor, alpha);
}
