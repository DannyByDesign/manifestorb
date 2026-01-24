// Sparkles Fragment Shader
// Soft circular points with alpha-based depth fading and white accents

precision highp float;

// ============================================
// Uniforms
// ============================================
uniform float uTime;
uniform vec3 uBaseColor;  // Saturated particle color (warm coral/pink)

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
  
  vec2 uv = gl_PointCoord - 0.5;
  float dist = length(uv);
  
  // Discard outside circle
  if (dist > 0.5) discard;
  
  // ========================================
  // SOFT GLOW FALLOFF
  // ========================================
  
  float glow = 1.0 - smoothstep(0.0, 0.5, dist);
  glow = glow * glow;  // Sharper center, softer edges
  
  // ========================================
  // FLICKER (per-particle twinkle)
  // ========================================
  
  float flicker = 0.8 + 0.2 * sin(uTime * 3.5 + vPhase * 6.28318);
  
  // ========================================
  // BRIGHTNESS (constant color, no depth dimming)
  // ========================================
  
  // All particles have full color brightness
  // Depth perception comes from alpha, not brightness
  float brightness = flicker * mix(1.2, 2.2, vIsWhite);
  
  // ========================================
  // COLOR SELECTION
  // ========================================
  
  // Warm white for accents
  vec3 white = vec3(1.0, 0.97, 0.9);
  
  // Mix between base color and white
  vec3 color = mix(uBaseColor, white, vIsWhite);
  
  // Apply brightness and glow
  color *= brightness * glow * 1.6;
  
  // ========================================
  // ALPHA (depth fading - this creates 3D perception)
  // ========================================
  
  // Depth controls transparency: front = opaque, back = transparent
  float alpha = vDepthFade * vRadialFade * glow * vMorphFade;
  
  // White accents slightly more opaque
  alpha *= mix(0.9, 1.0, vIsWhite);
  
  // ========================================
  // OUTPUT
  // ========================================
  
  gl_FragColor = vec4(color, alpha);
}

