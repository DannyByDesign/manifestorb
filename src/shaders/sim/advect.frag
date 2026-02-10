precision highp float;

varying vec2 vUv;

uniform sampler2D tVelocity;
uniform vec2 uTexelSize;
uniform float uDelta;
uniform float uDissipation;

void main() {
  vec2 velocity = texture2D(tVelocity, vUv).xy;
  vec2 coord = vUv - velocity * uDelta * 0.22;
  coord = clamp(coord, uTexelSize * 0.5, 1.0 - uTexelSize * 0.5);

  vec2 advected = texture2D(tVelocity, coord).xy;
  gl_FragColor = vec4(advected * uDissipation, 0.0, 1.0);
}
