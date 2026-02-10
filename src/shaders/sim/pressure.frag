precision highp float;

varying vec2 vUv;

uniform sampler2D tPressure;
uniform sampler2D tDivergence;
uniform vec2 uTexelSize;

void main() {
  float pL = texture2D(tPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
  float pR = texture2D(tPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
  float pB = texture2D(tPressure, vUv - vec2(0.0, uTexelSize.y)).x;
  float pT = texture2D(tPressure, vUv + vec2(0.0, uTexelSize.y)).x;

  float divergence = texture2D(tDivergence, vUv).x;
  float pressure = (pL + pR + pB + pT - divergence) * 0.25;

  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}
