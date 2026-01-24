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
  // SPRITE UV TRANSFORM
  // ========================================
  
  vec2 uv = gl_PointCoord - 0.5;
  uv.x *= vAspect;              // subtle ellipse
  uv = rot2(uv, vRot);          // rotate
  vec2 suv = uv + 0.5;          // back to 0..1
  
  // Bounds check (discard if rotated UV is outside)
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
    discard;
  }
  
  // ========================================
  // PROCEDURAL SHAPE GENERATION (No Textures)
  // ========================================

  float dist = length(suv - 0.5) * 2.0; // 0..1 from center
  float shapeAlpha = 0.0;
  
  // Choose shape based on vSprite (0=Dust, 1=Body, 2=Glint)
  if (vSprite < 0.5) {
    // DUST: Soft Gaussian Blob
    // exp(-dist^2 * falloff)
    shapeAlpha = exp(-dist * dist * 3.0);
    shapeAlpha *= 0.6; // Slightly dimmer base
    
  } else if (vSprite < 1.5) {
    // BODY: "Sphere" look (Volume)
    // NOT a flat circle. Use power function to simulate curvature shading.
    // 1.0 at center, falling off to 0.0 at edge
    float sphere = 1.0 - smoothstep(0.0, 1.0, dist);
    shapeAlpha = pow(sphere, 1.5); // 1.5 exp gives it a "round" shading falloff
    
    // Hard clip at edge to keep it contained? Or soft?
    // User asked for "reads like a sphere", so a smooth but defined edge is good.
    // The power function handles the volume. Let's ensure it clips at 1.0
    if (dist >= 1.0) shapeAlpha = 0.0;
    
  } else {
    // GLINT: "Glowing Circle" (Bright Core + Soft Glow)
    // No rays/star shape anymore.
    
    // Core (intense center)
    float core = exp(-dist * dist * 16.0);
    
    // Outer glow (softer falloff)
    float glow = exp(-dist * dist * 3.0) * 0.5;
    
    // Combine
    shapeAlpha = max(core, glow);
    
    // Clip at edge to keep it tidy
    if (dist >= 1.0) shapeAlpha = 0.0;
  }

  // Basic alpha threshold
  if (shapeAlpha < 0.01) discard;

  // ========================================
  // FLICKER / TWINKLE
  // ========================================
  
  // Layer-based character
  // Dust (layer=0): Slow breathe
  // Body (layer=1): Gentle pulse
  // Glint (layer=2): Rapid sparkle
  
  float speed = (vLayer < 0.5) ? 0.5 : (vLayer < 1.5) ? 2.0 : 6.0;
  float amp = (vLayer < 0.5) ? 0.05 : (vLayer < 1.5) ? 0.15 : 0.4;
  
  float flicker = 1.0 - amp + amp * sin(uTime * speed + vTwinkle * 6.28 + vPhase * 3.0);
  
  // ========================================
  // BRIGHTNESS & COLOR (Bloom Disabled)
  // ========================================
  
  float brightnessMult = vBrightness;
  
  vec3 warmTint = vec3(1.0, 0.92, 0.95);
  vec3 coolTint = vec3(0.92, 0.95, 1.0);
  vec3 hueTint = mix(coolTint, warmTint, vSeed);
  
  vec3 color;
  float alpha = shapeAlpha;
  
  if (vIsWhite > 0.5 || vLayer > 1.5) {
    // GLINT
    // Boosted slightly but CLAMPED to LDR since bloom is off.
    // Use uGlowColor for the outer glow, White for core.
    vec3 glintColor = mix(uGlowColor, vec3(1.0), shapeAlpha);
    
    color = glintColor * flicker * brightnessMult * 1.5;
    
    // Modulate alpha by shape
    alpha *= 1.0; 
  } else {
    // BODY / DUST
    color = uBaseColor * hueTint * flicker;
    color *= (0.5 + 0.5 * shapeAlpha);
  }
  
  // Clamp all colors to standard range [0, 1] to ensure no bloom triggering
  // even if it were enabled (safety).
  color = min(color, vec3(1.0));
  
  // ========================================
  // ALPHA FADES
  // ========================================
  
  float lifeAlpha = smoothstep(0.0, 0.2, vLife);
  alpha *= vDepthFade * vRadialFade * vMorphFade * lifeAlpha;
  
  // ========================================
  // DITHERING (Filmic Lift)
  // ========================================
  
  float dither = (hash12(gl_FragCoord.xy + uTime * 0.1) - 0.5) * 0.03;
  alpha = clamp(alpha + dither, 0.0, 1.0);
  
  gl_FragColor = vec4(color, alpha);
}
