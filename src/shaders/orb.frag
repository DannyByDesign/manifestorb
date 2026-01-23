// Orb Fragment Shader
// "Cool Neutral Glass" model
// Driven by CSS variables passed as uniforms

varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;
varying vec3 vPosition;

uniform float uTime;
// Colors from CSS
uniform vec3 uBaseColor; // Pale Lavender Gray
uniform vec3 uCoolColor; // Cool Tint
uniform vec3 uWarmColor; // Warm Tint

float fresnel(float cosTheta, float power) {
  return pow(1.0 - cosTheta, power);
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewDir);
  vec3 L = normalize(vec3(-1.0, 1.0, 1.0)); // Main light from top-left
  
  float NdotV = max(dot(N, V), 0.0);
  float NdotL = max(dot(N, L), 0.0);
  
  // --- 1. Base Glass Body ---
  vec3 color = uBaseColor;
  
  // --- 2. Environment Gradient Mapping ---
  // Diagonal gradient: Cool (Top-Left) to Warm (Bottom-Right)
  // We project normal onto the diagonal axis
  float gradientFactor = dot(N, normalize(vec3(1.0, -1.0, 0.0))); 
  // Map -1..1 to 0..1 with some shaping
  float t = smoothstep(-0.8, 0.8, gradientFactor);
  
  // Mix Cool to Warm based on normal direction
  // Note: gradientFactor > 0 is towards bottom-right (warm), < 0 is top-left (cool)
  // But wait, vec3(1, -1, 0) points Right-Down.
  // So if Normal aligns with Right-Down, t is high -> Warm.
  // If Normal aligns with Left-Up (-1, 1, 0), t is low -> Cool.
  vec3 envTint = mix(uCoolColor, uWarmColor, t);
  
  // Blend tint into base (Deep blending for glass feel)
  color = mix(color, envTint, 0.4);

  // --- 3. Holographic Sheen (Iridescence) ---
  // View-dependent color shift on grazing angles
  float iridescent = fresnel(NdotV, 2.5);
  // Subtle rainbow shift:
  vec3 holoColor = 0.5 + 0.5 * cos(vec3(0.0, 0.33, 0.67) * 6.28 + iridescent * 3.0 + uTime * 0.2);
  // Mask sheen to rim/grazing angles and keep it subtle
  color += holoColor * iridescent * 0.15;
  
  // --- 4. Lighting & Highlights ---
  
  // Soft top-left specular (Softbox feel)
  float spec = pow(NdotL, 8.0);
  color += vec3(1.0) * spec * 0.3;
  
  // Sharp hotspot (Point light)
  float heavySpec = pow(NdotL, 32.0);
  color += vec3(1.0) * heavySpec * 0.4;
  
  // Edge/Rim Light (Atmospheric)
  // Using the Cool color for the rim to define the shape
  float rim = fresnel(NdotV, 4.0);
  // Feather the rim so it's not a hard line
  rim = smoothstep(0.2, 1.0, rim);
  color += uCoolColor * rim * 0.6;

  // --- 5. Tone Mapping / Output ---
  gl_FragColor = vec4(color, 1.0);
}
