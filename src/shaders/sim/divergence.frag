precision highp float;

varying vec2 vUv;

uniform sampler2D tVelocity;
uniform vec2 uTexelSize;

void main() {
  vec2 vL = texture2D(tVelocity, vUv - vec2(uTexelSize.x, 0.0)).xy;
  vec2 vR = texture2D(tVelocity, vUv + vec2(uTexelSize.x, 0.0)).xy;
  vec2 vB = texture2D(tVelocity, vUv - vec2(0.0, uTexelSize.y)).xy;
  vec2 vT = texture2D(tVelocity, vUv + vec2(0.0, uTexelSize.y)).xy;

  float divergence = 0.5 * ((vR.x - vL.x) + (vT.y - vB.y));
  gl_FragColor = vec4(divergence, 0.0, 0.0, 1.0);
}
