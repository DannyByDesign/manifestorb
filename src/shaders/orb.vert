// Orb Vertex Shader
// Fullscreen quad for SDF raymarching
// Used with a PlaneGeometry(2, 2) that covers clip space

varying vec2 vUv;

void main() {
  vUv = uv;
  
  // Position is already in clip space (-1 to 1)
  // No transformation needed
  gl_Position = vec4(position.xy, 0.0, 1.0);
}

