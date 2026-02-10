precision highp float;

varying vec2 vUv;

uniform sampler2D tVelocity;
uniform float uTime;
uniform float uDelta;
uniform vec2 uMouse;
uniform float uMouseStrength;
uniform float uAspect;

uniform float uMacroStrength;
uniform float uMesoStrength;
uniform float uMicroStrength;
uniform float uVortexStrength;
uniform float uBreathSpeed;
uniform float uMaxSpeed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);

  float a = hash(i + vec2(0.0, 0.0));
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 curl2(vec2 p) {
  const float e = 0.0015;
  float nL = noise(p - vec2(e, 0.0));
  float nR = noise(p + vec2(e, 0.0));
  float nB = noise(p - vec2(0.0, e));
  float nT = noise(p + vec2(0.0, e));
  return vec2(nT - nB, -(nR - nL)) / (2.0 * e);
}

vec2 swirl(vec2 p) {
  float r2 = dot(p, p);
  vec2 tang = normalize(vec2(-p.y, p.x) + 1e-4);
  return tang * exp(-r2 * 1.5);
}

vec2 movingVortex(vec2 p, vec2 center, float scale) {
  vec2 d = p - center;
  float falloff = exp(-dot(d, d) * scale);
  vec2 tang = normalize(vec2(-d.y, d.x) + 1e-5);
  return tang * falloff;
}

void main() {
  vec2 base = texture2D(tVelocity, vUv).xy;

  vec2 p = vec2((vUv.x - 0.5) * uAspect, vUv.y - 0.5);

  float breathA = 0.5 + 0.5 * sin(uTime * uBreathSpeed);
  float breathB = 0.5 + 0.5 * sin(uTime * (uBreathSpeed * 0.73) + 1.37);

  vec2 macro = swirl(p);
  vec2 meso = curl2(p * 2.8 + vec2(uTime * 0.06, -uTime * 0.05));
  vec2 micro = curl2(p * 10.5 + vec2(uTime * 0.3, uTime * 0.22));

  vec2 c0 = vec2(sin(uTime * 0.31) * 0.22, cos(uTime * 0.27) * 0.18);
  vec2 c1 = vec2(cos(uTime * 0.19 + 1.2) * 0.27, sin(uTime * 0.23 + 0.5) * 0.22);
  vec2 vortices = movingVortex(p, c0, 18.0) + movingVortex(p, c1, 15.0);

  vec2 force = vec2(0.0);
  force += macro * (uMacroStrength * mix(0.7, 1.2, breathA));
  force += meso * (uMesoStrength * mix(0.6, 1.25, breathB));
  force += micro * (uMicroStrength * mix(0.4, 1.35, breathA * breathB));
  force += vortices * (uVortexStrength * mix(0.75, 1.35, breathB));

  if (uMouseStrength > 0.001) {
    vec2 mp = vec2((uMouse.x - 0.5) * uAspect, uMouse.y - 0.5);
    vec2 toMouse = p - mp;
    float mFalloff = exp(-dot(toMouse, toMouse) * 22.0) * uMouseStrength;
    vec2 tang = normalize(vec2(-toMouse.y, toMouse.x) + 1e-5);
    force += tang * mFalloff * 1.5;
  }

  vec2 velocity = base + force * (uDelta * 2.0);
  float speed = length(velocity);
  if (speed > uMaxSpeed) {
    velocity = velocity / speed * uMaxSpeed;
  }

  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
