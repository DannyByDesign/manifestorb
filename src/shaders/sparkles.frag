// Sparkles Fragment Shader
// 3D sphere-shaded particles with alpha-based depth fading

precision highp float;

// ============================================
// Uniforms
// ============================================
uniform float uTime;
uniform vec3 uBaseColor;  // Base particle color (purple)
uniform vec3 uGlowColor;  // Glowing white accent color (white with purple hint)

// ============================================
// Varyings (from vertex shader)
// ============================================
varying float vDepthFade;   // 1.0 = near/opaque, 0.0 = far/transparent
varying float vRadialFade;  // 1.0 = center, 0.0 = edge (halo effect)
varying float vPhase;       // Random phase for flicker
varying float vIsWhite;     // 1.0 for white accent, 0.0 for base
varying float vMorphFade;   // 1.0 when visible, 0.0 when morphed

void main() {
  // ========================================
  // CIRCULAR POINT SHAPE
  // ========================================
  
  vec2 uv = gl_PointCoord - 0.5;  // -0.5 to 0.5
  float dist = length(uv);
  
  // Hard circle edge
  if (dist > 0.5) discard;
  
  // ========================================
  // 3D SPHERE SHADING
  // ========================================
  
  // Calculate sphere normal (as if looking at a 3D sphere)
  // z component derived from sphere equation: x² + y² + z² = r²
  float z = sqrt(max(0.0, 0.25 - dist * dist));  // 0.25 = 0.5²
  vec3 normal = normalize(vec3(uv * 2.0, z));
  
  // Light from top-left-front
  vec3 lightDir = normalize(vec3(-0.4, -0.5, 1.0));
  float lighting = dot(normal, lightDir) * 0.5 + 0.5;  // Remap to 0-1
  
  // ========================================
  // FLICKER (per-particle twinkle)
  // ========================================
  
  float flicker = 0.85 + 0.15 * sin(uTime * 3.5 + vPhase * 6.28318);
  
  // ========================================
  // COLOR (different treatment for base vs glow sparkles)
  // ========================================
  
  vec3 color;
  float finalAlphaMult = 1.0;
  
  if (vIsWhite > 0.5) {
    // GLOWING WHITE SPARKLES
    // Soft glow falloff (no hard sphere shading)
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = glow * glow;  // Soft radial falloff
    
    // Bright center fading to purple-tinted edges
    vec3 coreColor = vec3(1.0);  // Pure white center
    vec3 edgeColor = uGlowColor; // Purple-tinted white at edges
    color = mix(edgeColor, coreColor, glow) * flicker * 2.5;
    
    // Glow affects alpha (soft edges)
    finalAlphaMult = glow;
  } else {
    // BASE COLOR SPARKLES (3D sphere shaded)
    color = uBaseColor * lighting * flicker * 1.3;
  }
  
  // ========================================
  // ALPHA (depth fading - this creates depth perception)
  // ========================================
  
  // Depth controls transparency: front = opaque, back = transparent
  float alpha = vDepthFade * vRadialFade * vMorphFade * finalAlphaMult;
  
  // ========================================
  // OUTPUT
  // ========================================
  
  gl_FragColor = vec4(color, alpha);
}
