precision highp float;

varying vec2 vUv;

uniform sampler2D tVelocity;
uniform sampler2D tPressure;
uniform vec2 uTexelSize;

void main() {
  float pL = texture2D(tPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float pR = texture2D(tPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float pB = texture2D(tPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float pT = texture2D(tPressure, vUv + vec2(0.0, uTexelSize.y)).x;

  vec2 velocity = texture2D(tVelocity, vUv).xy;
  velocity -= vec2(pR - pL, pT - pB) * 0.5;

  gl_FragColor = vec4(velocity, 0.0, 1.0);
}
