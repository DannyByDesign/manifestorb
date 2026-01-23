// Orb Vertex Shader
// Standard transform + view direction for Fresnel
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vUv;
varying vec3 vPosition;

uniform float uTime;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vViewDir = normalize(cameraPosition - worldPos.xyz);
  vNormal = normalize(normalMatrix * normal);
  vUv = uv;
  vPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
