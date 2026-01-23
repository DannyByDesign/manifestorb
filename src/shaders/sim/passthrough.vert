// Fullscreen quad vertex shader for FBO simulation passes
// Works with a simple triangle strip or fullscreen triangle

// Input: clip-space positions for a fullscreen triangle
// Output: UV coordinates for texture sampling

out vec2 vUv;

void main() {
  // Fullscreen triangle technique:
  // vertex 0: (-1, -1), vertex 1: (3, -1), vertex 2: (-1, 3)
  // This covers the entire clip space with a single triangle
  
  float x = float((gl_VertexID & 1) << 2) - 1.0;
  float y = float((gl_VertexID & 2) << 1) - 1.0;
  
  vUv = vec2(x, y) * 0.5 + 0.5;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
