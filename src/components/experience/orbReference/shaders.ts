export const fragmentShader = `
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;
  uniform float uTime;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float r = length(p);

    // Softer edge for better blending
    float edge = 0.45;
    float aa = fwidth(r);
    float alpha = 1.0 - smoothstep(edge - aa, edge + aa, r);
    if (alpha <= 0.0) discard;

    // Create gradient based on position within the particle
    float gradient = gl_PointCoord.y;
    float gradient2 = gl_PointCoord.x;
    float radialGradient = 1.0 - r * 1.2;

    // Mix all 4 colors based on position for variety
    vec3 col;

    if (gradient < 0.25) {
      float t = gradient * 4.0;
      col = mix(uColor1, uColor2, t);
    } else if (gradient < 0.5) {
      float t = (gradient - 0.25) * 4.0;
      col = mix(uColor2, uColor3, t);
    } else if (gradient < 0.75) {
      float t = (gradient - 0.5) * 4.0;
      col = mix(uColor3, uColor4, t);
    } else {
      float t = (gradient - 0.75) * 4.0;
      col = mix(uColor4, uColor1, t);
    }

    // Add subtle variation with x-gradient
    vec3 col2;
    if (gradient2 < 0.33) {
      float t = gradient2 * 3.0;
      col2 = mix(uColor1, uColor3, t);
    } else if (gradient2 < 0.66) {
      float t = (gradient2 - 0.33) * 3.0;
      col2 = mix(uColor3, uColor4, t);
    } else {
      float t = (gradient2 - 0.66) * 3.0;
      col2 = mix(uColor4, uColor2, t);
    }

    // Blend both gradients for rich color variation
    col = mix(col, col2, 0.4);

    // Gentle brightness falloff from center
    col *= (0.85 + radialGradient * 0.3);

    // Very subtle sparkle for highlight particles
    float sparkle = sin(gl_PointCoord.x * 25.0) * sin(gl_PointCoord.y * 25.0) * 0.02;
    col += sparkle;

    // Adjust alpha based on color brightness
    float brightness = (col.r + col.g + col.b) / 3.0;
    float finalAlpha = alpha * (0.85 + brightness * 0.15);

    gl_FragColor = vec4(col, finalAlpha);
  }
`;

export const vertexShader = `
  uniform sampler2D uPositions;
  uniform float uTime;
  uniform float uPointSize;

  void main() {
    vec3 pos = texture2D(uPositions, position.xy).xyz;

    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition  = viewMatrix  * modelPosition;
    vec4 projected     = projectionMatrix * viewPosition;

    gl_Position = projected;

    // Size variation for scattered look
    float size = uPointSize;

    // Gentle size variation for organic feel
    float variation = sin(pos.x * 7.0 + uTime * 0.4) * 0.2 +
                      cos(pos.y * 6.0 + uTime * 0.3) * 0.15 + 0.7;
    size *= variation;

    // Distance attenuation
    size *= (1.6 / (1.0 + abs(viewPosition.z) * 0.2));

    gl_PointSize = size;
  }
`;

export const simulationVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;

    vec4 modelPosition = modelMatrix * vec4(position, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;

    gl_Position = projectedPosition;
  }
`;

export const simulationFragmentShader = `
  uniform sampler2D positions;
  uniform float uTime;
  uniform float uFrequency;

  varying vec2 vUv;

  // Source: https://github.com/drcmda/glsl-curl-noise2
  // and: https://github.com/guoweish/glsl-noise-simplex/blob/master/3d.glsl

  //
  // Description : Array and textureless GLSL 2D/3D/4D simplex
  //               noise functions.
  //      Author : Ian McEwan, Ashima Arts.
  //  Maintainer : ijm
  //     Lastmod : 20110822 (ijm)
  //     License : Copyright (C) 2011 Ashima Arts. All rights reserved.
  //               Distributed under the MIT License. See LICENSE file.
  //               https://github.com/ashima/webgl-noise
  //

  vec3 mod289(vec3 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 mod289(vec4 x) {
    return x - floor(x * (1.0 / 289.0)) * 289.0;
  }

  vec4 permute(vec4 x) {
    return mod289(((x*34.0)+1.0)*x);
  }

  vec4 taylorInvSqrt(vec4 r)
  {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

  float snoise(vec3 v)
  {
    const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
    const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

    // First corner
    vec3 i  = floor(v + dot(v, C.yyy) );
    vec3 x0 =   v - i + dot(i, C.xxx) ;

    // Other corners
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min( g.xyz, l.zxy );
    vec3 i2 = max( g.xyz, l.zxy );

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    // Permutations
    i = mod289(i);
    vec4 p = permute( permute( permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

      // Gradients: 7x7 points over a square, mapped onto an octahedron.
      // The ring size 17*17 = 289 is close to a multiple of 49 (49*6 = 294)
      float n_ = 0.142857142857; // 1.0/7.0
      vec3  ns = n_ * D.wyz - D.xzx;

      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_ );

      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);

      vec4 b0 = vec4( x.xy, y.xy );
      vec4 b1 = vec4( x.zw, y.zw );

      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));

      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

      vec3 p0 = vec3(a0.xy,h.x);
      vec3 p1 = vec3(a0.zw,h.y);
      vec3 p2 = vec3(a1.xy,h.z);
      vec3 p3 = vec3(a1.zw,h.w);

      // Normalise gradients
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;

      // Mix final noise value
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                     dot(p2,x2), dot(p3,x3) ) );
  }


  vec3 snoiseVec3( vec3 x ){

    float s  = snoise(vec3( x ));
    float s1 = snoise(vec3( x.y - 19.1 , x.z + 33.4 , x.x + 47.2 ));
    float s2 = snoise(vec3( x.z + 74.2 , x.x - 124.5 , x.y + 99.4 ));
    vec3 c = vec3( s , s1 , s2 );
    return c;

  }


  vec3 curlNoise( vec3 p ){

    const float e = .1;
    vec3 dx = vec3( e   , 0.0 , 0.0 );
    vec3 dy = vec3( 0.0 , e   , 0.0 );
    vec3 dz = vec3( 0.0 , 0.0 , e   );

    vec3 p_x0 = snoiseVec3( p - dx );
    vec3 p_x1 = snoiseVec3( p + dx );
    vec3 p_y0 = snoiseVec3( p - dy );
    vec3 p_y1 = snoiseVec3( p + dy );
    vec3 p_z0 = snoiseVec3( p - dz );
    vec3 p_z1 = snoiseVec3( p + dz );

    float x = p_y1.z - p_y0.z - p_z1.y + p_z0.y;
    float y = p_z1.x - p_z0.x - p_x1.z + p_x0.z;
    float z = p_x1.y - p_x0.y - p_y1.x + p_y0.x;

    const float divisor = 1.0 / ( 2.0 * e );
    return normalize( vec3( x , y , z ) * divisor );

  }


  void main() {
    vec3 pos = texture2D(positions, vUv).rgb;
    float radial = max(length(pos), 0.0001);
    float t = uTime;
    float freqBase = clamp(uFrequency, 0.08, 2.2);

    float freq1 = freqBase * (0.9 + sin(pos.x * 4.0) * 0.2);
    float freq2 = freqBase * (1.1 + cos(pos.y * 4.0) * 0.3);

    vec3 curlLarge = curlNoise(pos * freq1 + vec3(0.0, t * 0.08, 0.0));
    vec3 curlFine = curlNoise((pos + vec3(2.1, -1.3, 0.7)) * freq2 - vec3(t * 0.11, 0.0, t * 0.07));

    vec3 driftAxis = normalize(vec3(0.24, 0.87, 0.42));
    vec3 orbital = cross(driftAxis, pos + curlLarge * 0.35);
    float orbitalMod = 0.62 + 0.38 * sin(t * 0.34 + pos.y * 4.8 + pos.x * 2.4);

    float shearBand = smoothstep(0.22, 0.96, radial) * (0.55 + 0.45 * sin(pos.y * 8.4 + t * 0.52));
    vec3 shear = vec3(-pos.y, pos.x, sin(pos.x * 4.2 + t * 0.24) * 0.32) * shearBand;

    vec3 lobeA = vec3(0.3, -0.1, 0.18);
    vec3 lobeB = vec3(-0.24, 0.16, -0.08);
    vec3 toA = lobeA - pos;
    vec3 toB = lobeB - pos;
    vec3 attract = toA / (0.18 + dot(toA, toA)) + toB / (0.2 + dot(toB, toB));

    float breath = sin(t * 0.6 + radial * 8.3) * 0.22;
    vec3 radialDir = pos / radial;
    vec3 compression = -radialDir * ((radial - 0.5) * 0.42 + breath * 0.2);

    vec3 flow = mix(curlLarge, curlFine, 0.58);
    vec3 velocity =
      orbital * orbitalMod * 0.78 +
      flow * 0.92 +
      shear * 0.55 +
      attract * 0.16 +
      compression;

    vec3 nextPos = pos + velocity * 0.09;

    float nextLen = max(length(nextPos), 0.0001);
    float conf = smoothstep(0.72, 1.06, nextLen);
    vec3 confined = nextPos / nextLen * 0.76;
    nextPos = mix(nextPos, confined, conf * 0.9);

    vec3 jitter = vec3(
      snoise(vec3(nextPos.xy * 7.0, t * 0.17)),
      snoise(vec3(nextPos.yz * 6.5, t * 0.19)),
      snoise(vec3(nextPos.zx * 6.9, t * 0.21))
    ) * 0.0035;

    gl_FragColor = vec4(nextPos + jitter, 1.0);
  }
`;
