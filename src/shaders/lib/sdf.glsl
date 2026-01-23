// SDF (Signed Distance Function) Primitives Library
// Used for raymarched shape rendering and organic shape morphing
//
// Conventions:
// - All SDFs return positive distance outside, negative inside
// - 'p' is the sample point in object space
// - Shapes are centered at origin unless otherwise noted

// ============================================
// Primitive Shapes
// ============================================

// Sphere centered at origin
// r: radius
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

// Box centered at origin (exact SDF)
// b: half-extents (width/2, height/2, depth/2)
float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Rounded box centered at origin
// b: half-extents BEFORE rounding (actual size = b, corners carved inward)
// r: corner radius
float sdRoundedBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Capsule / pill shape between two points
// a, b: endpoints of the capsule's line segment
// r: radius
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Vertical capsule centered at origin
// h: height (distance between sphere centers)
// r: radius
float sdVerticalCapsule(vec3 p, float h, float r) {
  p.y -= clamp(p.y, -h * 0.5, h * 0.5);
  return length(p) - r;
}

// Torus centered at origin, lying in XZ plane
// t.x: major radius (distance from center to tube center)
// t.y: minor radius (tube radius)
float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

// Cylinder centered at origin, aligned with Y axis
// h: half-height
// r: radius
float sdCylinder(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Ellipsoid centered at origin
// r: radii in x, y, z directions
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// ============================================
// Boolean Operations
// ============================================

// Union (combine two shapes)
float opUnion(float d1, float d2) {
  return min(d1, d2);
}

// Subtraction (carve d2 out of d1)
float opSubtraction(float d1, float d2) {
  return max(d1, -d2);
}

// Intersection (keep only where both shapes overlap)
float opIntersection(float d1, float d2) {
  return max(d1, d2);
}

// ============================================
// Smooth Boolean Operations (Organic Blending)
// ============================================

// Smooth union — organic blend between two shapes
// k: smoothness factor (larger = smoother blend, 0.1-0.5 typical)
float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// Smooth subtraction — organic carving
// k: smoothness factor
float opSmoothSubtraction(float d1, float d2, float k) {
  float h = clamp(0.5 - 0.5 * (d2 + d1) / k, 0.0, 1.0);
  return mix(d1, -d2, h) + k * h * (1.0 - h);
}

// Smooth intersection
// k: smoothness factor
float opSmoothIntersection(float d1, float d2, float k) {
  float h = clamp(0.5 - 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) + k * h * (1.0 - h);
}

// ============================================
// Shape Morphing
// ============================================

// Linear interpolation between two SDFs
// t: blend factor (0 = d1, 1 = d2)
float opMorph(float d1, float d2, float t) {
  return mix(d1, d2, t);
}

// Smooth morph using smooth minimum for organic feel
// t: blend factor, k: smoothness
float opSmoothMorph(float d1, float d2, float t, float k) {
  // Bias the smooth union based on t
  float biasedD1 = d1 + (1.0 - t) * -k;
  float biasedD2 = d2 + t * -k;
  return opSmoothUnion(biasedD1, biasedD2, k * 0.5);
}

// ============================================
// Domain Operations (Transformations)
// ============================================

// Translate a point (apply before SDF)
// Usage: sdSphere(opTranslate(p, offset), r)
vec3 opTranslate(vec3 p, vec3 offset) {
  return p - offset;
}

// Rotate around Y axis
vec3 opRotateY(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Rotate around X axis
vec3 opRotateX(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

// Rotate around Z axis
vec3 opRotateZ(vec3 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Uniform scale (divides distance by scale factor)
// Usage: sdSphere(p / scale, r) * scale
// Note: For non-uniform scale, use the pattern but results may be approximate

// ============================================
// Distance Field Utilities
// ============================================

// Round an SDF (add radius to edges)
float opRound(float d, float r) {
  return d - r;
}

// Onion (hollow out a shape)
// thickness: shell thickness
float opOnion(float d, float thickness) {
  return abs(d) - thickness;
}

// Extrusion helper for 2D SDFs
// Extrude a 2D SDF along Z axis
// d: 2D SDF value, p.z: sample z coordinate, h: half-height
float opExtrude(float d, float pz, float h) {
  vec2 w = vec2(d, abs(pz) - h);
  return min(max(w.x, w.y), 0.0) + length(max(w, 0.0));
}

// ============================================
// 2D SDF Primitives (for extrusion)
// ============================================

// 2D Circle
float sdCircle2D(vec2 p, float r) {
  return length(p) - r;
}

// 2D Rounded Rectangle
float sdRoundedRect2D(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// ============================================
// Normal Calculation
// ============================================

// Calculate normal from SDF using central differences
// Requires a scene SDF function: float sceneSDF(vec3 p)
// Usage: vec3 normal = calcNormal(hitPoint);
//
// Note: This is a template - copy and adapt to your shader:
//
// vec3 calcNormal(vec3 p) {
//   const float e = 0.0001;
//   return normalize(vec3(
//     sceneSDF(p + vec3(e, 0, 0)) - sceneSDF(p - vec3(e, 0, 0)),
//     sceneSDF(p + vec3(0, e, 0)) - sceneSDF(p - vec3(0, e, 0)),
//     sceneSDF(p + vec3(0, 0, e)) - sceneSDF(p - vec3(0, 0, e))
//   ));
// }

// Tetrahedron normal calculation (4 samples instead of 6, slightly faster)
// vec3 calcNormalTet(vec3 p) {
//   const float e = 0.0001;
//   const vec2 k = vec2(1, -1);
//   return normalize(
//     k.xyy * sceneSDF(p + k.xyy * e) +
//     k.yyx * sceneSDF(p + k.yyx * e) +
//     k.yxy * sceneSDF(p + k.yxy * e) +
//     k.xxx * sceneSDF(p + k.xxx * e)
//   );
// }

