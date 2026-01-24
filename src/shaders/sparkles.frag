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

void main() {
  // ========================================
  // CIRCULAR POINT SHAPE
  // ========================================
  
  vec2 uv = gl_PointCoord - 0.5;
  float dist = length(uv);
  
  if (dist > 0.5) discard;
  
  // ========================================
  // 3D SPHERE SHADING
  // ========================================
  
  float z = sqrt(max(0.0, 0.25 - dist * dist));
  vec3 normal = normalize(vec3(uv * 2.0, z));
  
  vec3 lightDir = normalize(vec3(-0.4, -0.5, 1.0));
  float lighting = dot(normal, lightDir) * 0.5 + 0.5;
  
  // ========================================
  // FLICKER
  // ========================================
  
  float flicker = 0.85 + 0.15 * sin(uTime * 3.5 + vPhase * 6.28318);
  
  // ========================================
  // COLOR
  // ========================================
  
  vec3 color;
  float finalAlphaMult = 1.0;
  
  if (vIsWhite > 0.5) {
    // GLOWING WHITE SPARKLES
    float glow = 1.0 - smoothstep(0.0, 0.5, dist);
    glow = glow * glow;
    
    vec3 coreColor = vec3(1.0);
    vec3 edgeColor = uGlowColor;
    color = mix(edgeColor, coreColor, glow) * flicker * 2.5;
    
    finalAlphaMult = glow;
  } else {
    // BASE COLOR SPARKLES (3D sphere shaded)
    color = uBaseColor * lighting * flicker * 1.3;
  }
  
  // ========================================
  // ALPHA (life-based + depth-based)
  // ========================================
  
  // Life fade (particles fade as they die)
  float lifeAlpha = smoothstep(0.0, 0.2, vLife);
  
  // Combined alpha
  float alpha = vDepthFade * vRadialFade * vMorphFade * finalAlphaMult * lifeAlpha;
  
  // ========================================
  // OUTPUT
  // ========================================
  
  gl_FragColor = vec4(color, alpha);
}
