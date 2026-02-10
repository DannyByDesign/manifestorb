precision highp float;

uniform float uTime;
uniform vec3 uBaseColor;
uniform vec3 uGlowColor;
uniform int uRenderMode; // 0=body+dust, 1=glint

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

void main() {
  bool isGlint = vLayer > 1.5;
  if (uRenderMode == 0 && isGlint) discard;
  if (uRenderMode == 1 && !isGlint) discard;

  vec2 uv = gl_PointCoord - 0.5;
  float dist = length(uv) * 2.0;
  if (dist > 1.0) discard;

  float z = sqrt(max(0.0, 1.0 - dist * dist));
  vec3 normal = normalize(vec3(uv * 2.0, z));

  vec3 lightDir = normalize(vec3(-0.8, 1.0, 0.9));
  float diffuse = max(dot(normal, lightDir), 0.0);
  float ambient = 0.34;

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVec = normalize(lightDir + viewDir);
  float specular = pow(max(dot(normal, halfVec), 0.0), 34.0);

  // Keep the palette in your lavender family, but widen dynamic range.
  vec3 coolTint = vec3(0.86, 0.80, 1.00);
  vec3 warmTint = vec3(0.76, 0.60, 0.97);
  vec3 hueTint = mix(coolTint, warmTint, vSeed);

  vec3 baseCol = uBaseColor * hueTint;
  vec3 litColor = baseCol * (diffuse * 0.78 + ambient);
  litColor += vec3(1.0) * specular * 0.42;

  float alpha;

  if (isGlint) {
    float glow = exp(-dist * dist * 9.5);
    float burst = 0.68 + 0.32 * sin(uTime * 5.8 + vTwinkle * 6.28318 + vPhase * 2.7);
    vec3 glintBase = mix(uGlowColor, vec3(1.0), glow * 0.6);
    litColor = glintBase * (1.1 + burst * 0.9);
    alpha = glow * (0.38 + burst * 0.45);
  } else {
    float shell = smoothstep(1.0, 0.82, dist);
    float pulseSpeed = vLayer < 0.5 ? 0.6 : 1.3;
    float pulseAmp = vLayer < 0.5 ? 0.05 : 0.14;
    float flicker = 1.0 - pulseAmp + pulseAmp * sin(uTime * pulseSpeed + vTwinkle * 6.28318 + vPhase * 2.0);
    litColor *= flicker;
    alpha = shell;
  }

  litColor *= vBrightness;

  float lifeAlpha = smoothstep(0.0, 0.22, vLife);
  alpha *= vDepthFade * vRadialFade * vMorphFade * lifeAlpha;

  gl_FragColor = vec4(litColor, alpha);
}
