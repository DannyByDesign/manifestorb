export const fragmentShader = `
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;
  uniform float uTime;
  uniform float uDensityBias;
  uniform float uAlphaBase;
  uniform float uAlphaBoost;
  uniform float uDarkTintMix;
  uniform float uDepthFade;
  uniform float uClumpFlatten;
  uniform float uFieldMode;
  uniform float uGlowBoost;

  varying float vSeed;
  varying float vRadial;
  varying float vDepth;
  varying float vClump;
  varying vec3 vParticlePos;

  void main() {
    vec2 p = gl_PointCoord - vec2(0.5);
    float r = length(p);

    float edge = 0.46;
    float aa = fwidth(r);
    float alpha = 1.0 - smoothstep(edge - aa, edge + aa, r);
    if (alpha <= 0.0) discard;

    vec3 orbDir = normalize(vParticlePos + vec3(1e-5));
    float orbY = clamp(orbDir.y * 0.5 + 0.5, 0.0, 1.0);
    float orbAzimuth = atan(orbDir.z, orbDir.x) / 6.28318530718 + 0.5;
    float orbRadius = clamp(length(vParticlePos.xy), 0.0, 1.25);
    float coreToRim = smoothstep(0.08, 1.0, orbRadius);
    float gradientY = clamp(mix(orbY, coreToRim, 0.64), 0.0, 1.0);
    float gradientX = fract(orbAzimuth + coreToRim * 0.28);
    float radialGradient = 1.0 - r * 1.25;

    vec3 col;
    if (gradientY < 0.25) {
      float t = gradientY * 4.0;
      col = mix(uColor1, uColor2, t);
    } else if (gradientY < 0.5) {
      float t = (gradientY - 0.25) * 4.0;
      col = mix(uColor2, uColor3, t);
    } else if (gradientY < 0.75) {
      float t = (gradientY - 0.5) * 4.0;
      col = mix(uColor3, uColor4, t);
    } else {
      float t = (gradientY - 0.75) * 4.0;
      col = mix(uColor4, uColor1, t);
    }

    vec3 col2;
    if (gradientX < 0.33) {
      float t = gradientX * 3.0;
      col2 = mix(uColor1, uColor3, t);
    } else if (gradientX < 0.66) {
      float t = (gradientX - 0.33) * 3.0;
      col2 = mix(uColor3, uColor4, t);
    } else {
      float t = (gradientX - 0.66) * 3.0;
      col2 = mix(uColor4, uColor2, t);
    }

    col = mix(col, col2, 0.28 + coreToRim * 0.22);

    float clumpSignal = mix(vClump, 0.5, uClumpFlatten);
    clumpSignal = mix(clumpSignal, 0.5, uFieldMode);
    float radialDensity = mix(
      (1.0 - vRadial) * 0.66,
      smoothstep(0.52, 1.05, vRadial) * 0.72,
      uFieldMode
    );
    float structure = clamp(clumpSignal * 0.74 + radialDensity + vSeed * 0.2 + uDensityBias, 0.0, 1.0);
    float filamentNoise =
      sin(vParticlePos.x * 12.0 + vParticlePos.y * 10.0 + uTime * 0.34) * mix(0.1, 0.045, uClumpFlatten) +
      cos(vParticlePos.z * 9.0 - uTime * 0.22) * mix(0.08, 0.035, uClumpFlatten);
    float filament = smoothstep(
      mix(0.34, 0.26, uClumpFlatten),
      mix(0.94, 0.88, uClumpFlatten),
      structure + filamentNoise
    );

    vec3 darkTint = mix(uColor4, uColor1, 0.55) * 0.58;
    col = mix(col, darkTint, filament * uDarkTintMix);

    float centerBoost = mix(0.66 + filament * 0.46, 0.84 + filament * 0.18, uFieldMode);
    col *= centerBoost * (0.88 + radialGradient * 0.28);

    float haloMask = smoothstep(0.62, 0.0, r);
    float whiteGlowStrength = 0.22 + (0.22 * uGlowBoost);
    vec3 haloGlow = vec3(1.0, 0.99, 1.0) * haloMask * whiteGlowStrength;
    col += haloGlow;

    float radialFade = 1.0 - smoothstep(0.78, 1.05, vRadial);
    float outerAlpha = smoothstep(0.55, 1.05, vRadial);
    float radialAlpha = mix(mix(0.58, 1.0, radialFade), mix(0.36, 1.0, outerAlpha), uFieldMode);
    float depthAtten = 1.0 - vDepth * uDepthFade;
    float finalAlpha = alpha * (uAlphaBase + filament * uAlphaBoost);
    finalAlpha *= radialAlpha * depthAtten;
    finalAlpha += haloMask * (0.055 + 0.045 * uGlowBoost);
    finalAlpha = clamp(finalAlpha, 0.0, 1.0);

    gl_FragColor = vec4(col, finalAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const vertexShader = `
  uniform sampler2D uPositions;
  uniform float uTime;
  uniform float uPointSize;
  uniform float uPositionScale;
  uniform float uClumpFlatten;

  varying float vSeed;
  varying float vRadial;
  varying float vDepth;
  varying float vClump;
  varying vec3 vParticlePos;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec2 sampleUv = position.xy;
    vec3 rawPos = texture2D(uPositions, sampleUv).xyz;
    vec3 pos = rawPos * uPositionScale;

    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projected = projectionMatrix * viewPosition;

    gl_Position = projected;

    vSeed = hash21(sampleUv);
    vRadial = clamp(length(rawPos), 0.0, 1.2);
    vDepth = clamp(abs(viewPosition.z) / 16.0, 0.0, 1.0);
    float clumpField =
      sin(rawPos.x * 8.5 + uTime * 0.31) +
      cos(rawPos.y * 7.3 - uTime * 0.27) +
      sin(rawPos.z * 6.1 + uTime * 0.42);
    vClump = clamp(clumpField * 0.166 + 0.5, 0.0, 1.0);
    vParticlePos = rawPos;

    float size = uPointSize;
    float variation =
      0.7 +
      0.25 * sin(rawPos.x * 7.0 + uTime * 0.4) +
      0.18 * cos(rawPos.y * 6.0 + uTime * 0.3);
    size *= variation;
    size *= mix(0.76, 1.28, mix(vClump, 0.5, uClumpFlatten));
    size *= mix(1.08, 0.74, smoothstep(0.35, 1.05, vRadial));
    size *= (1.7 / (1.0 + abs(viewPosition.z) * 0.2));

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
  uniform float uFieldMode;
  uniform float uTextureSize;

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

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float hash11(float x) {
    return fract(sin(x * 127.1 + 311.7) * 43758.5453123);
  }

  vec3 seededDirection(vec2 uv) {
    float azimuth = hash21(uv * 17.31 + 0.13) * 6.28318530718;
    float z = hash21(uv * 29.17 + 0.71) * 2.0 - 1.0;
    float ring = sqrt(max(0.0, 1.0 - z * z));
    return vec3(cos(azimuth) * ring, sin(azimuth) * ring, z);
  }

  vec3 rotateAroundAxis(vec3 v, vec3 axis, float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
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
    vec3 curlPos = texture2D(positions, vUv).rgb;

    // Keep bright accent particles on an independent flow field so they
    // spread through the orb volume without collapsing into the main stream.
    if (uFieldMode > 0.5) {
      float texSize = max(uTextureSize, 1.0);
      vec2 cell = floor(vUv * texSize);
      float idx = cell.x + cell.y * texSize;
      float s1 = hash11(idx * 0.73 + 0.19);
      float s2 = hash11(idx * 1.31 + 2.17);
      float s3 = hash11(idx * 1.9 + 5.7);
      float s4 = hash11(idx * 2.43 + 7.11);

      float phase = s1 * 6.28318530718;
      vec3 baseDir = seededDirection(vec2(s1, s2));
      vec3 axis = normalize(seededDirection(vec2(s3, s4)) + vec3(0.29, 0.47, -0.25));
      vec3 orbitDir = rotateAroundAxis(baseDir, axis, uTime * (0.2 + 0.26 * s2) + phase);

      // Keep accent particles out of the center so highlights stay distributed.
      float targetRadius = mix(0.28, 0.98, pow(s3, 0.3333333));
      vec3 targetPos = orbitDir * targetRadius;

      // Use a blueyard-like curl recipe but with per-particle offsets so this
      // group does not ride the exact same flow as the main particles.
      float freq1 = uFrequency * (0.9 + sin((pos.x + s1) * 4.0) * 0.2);
      float freq2 = uFrequency * (1.1 + cos((pos.y + s2) * 4.0) * 0.3);
      float freq3 = uFrequency * (1.3 + sin((pos.z + s3) * 4.0) * 0.4);

      vec3 seededPos = pos + vec3(s1 * 2.3, s2 * 2.9, s3 * 3.7);
      vec3 seededCurl = curlPos + vec3(s3 * 2.1, s1 * 3.1, s2 * 2.7);

      vec3 flowA = curlNoise(
        seededPos * freq1 +
        vec3(uTime * (0.08 + 0.025 * s1), -uTime * (0.07 + 0.03 * s2), uTime * (0.09 + 0.02 * s3))
      );
      vec3 flowB = curlNoise(
        seededCurl * freq2 +
        vec3(-uTime * (0.09 + 0.02 * s2), uTime * (0.1 + 0.03 * s3), -uTime * (0.08 + 0.02 * s1))
      );
      flowB += curlNoise(seededCurl * freq3) * 0.15;

      vec3 randomOffset = vec3(
        sin((flowA.y + phase) * 8.0 + uTime * (0.92 + 0.38 * s2)) * 0.08,
        cos((flowA.z + phase) * 8.0 + uTime * (1.03 + 0.32 * s3)) * 0.08,
        sin((flowA.x + phase) * 8.0 + uTime * (0.86 + 0.36 * s1)) * 0.08
      );

      vec3 nextPos = mix(flowA, flowB, 0.5) + randomOffset;
      nextPos = mix(nextPos, targetPos, 0.18);

      float nextLen = max(length(nextPos), 1e-4);
      nextPos += (nextPos / nextLen) * (targetRadius - nextLen) * 0.34;

      nextLen = length(nextPos);
      if (nextLen > 1.0) {
        nextPos *= 1.0 / nextLen;
      } else if (nextLen < 0.12) {
        nextPos = normalize(targetPos + vec3(1e-4)) * targetRadius * 0.9;
      }

      gl_FragColor = vec4(nextPos, 1.0);
      return;
    }

    // Gentle movement for particles
    float freq1 = uFrequency * (0.9 + sin(pos.x * 4.0) * 0.2);
    float freq2 = uFrequency * (1.1 + cos(pos.y * 4.0) * 0.3);
    float freq3 = uFrequency * (1.3 + sin(pos.z * 4.0) * 0.4);

    pos = curlNoise(pos * freq1 + uTime * 0.08);
    curlPos = curlNoise(curlPos * freq2 + uTime * 0.1);
    curlPos += curlNoise(curlPos * freq3) * 0.15;

    vec3 randomOffset = vec3(
      sin(pos.y * 8.0 + uTime) * 0.08,
      cos(pos.z * 8.0 + uTime * 1.1) * 0.08,
      sin(pos.x * 8.0 + uTime * 0.9) * 0.08
    );

    gl_FragColor = vec4(mix(pos, curlPos, 0.5) + randomOffset, 1.0);
  }
`;
