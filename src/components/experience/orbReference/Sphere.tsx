import { type ComponentProps, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

type RimSparkleSphereProps = ComponentProps<"mesh"> & {
  colorA?: string;
  colorB?: string;
  colorC?: string;
};

export function RimSparkleSphere({
  colorA = "#F4EFF7",
  colorB = "#E6B2A0",
  colorC = "#866AD6",
  ...props
}: RimSparkleSphereProps) {
  const mat = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uColorC: { value: new THREE.Color(colorC) },
      uGlow: { value: 1.0 },
      uRimWidth: { value: 1.05 },
      uRimPower: { value: 3.5 },
      uRimIntensity: { value: 0.5 },
      uGrain: { value: 0.03 },
      uOpacity: { value: 1.0 },
    }),
    [colorA, colorB, colorC]
  );

  const vertex = /* glsl */ `
    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    varying vec3 vViewDirW;

    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;

      // world-space normal
      vNormalW = normalize(mat3(modelMatrix) * normal);

      // view direction (world)
      vViewDirW = normalize(cameraPosition - vWorldPos);

      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `;

  const fragment = /* glsl */ `
    uniform float uTime;
    uniform vec3 uColorA;
    uniform vec3 uColorB;
    uniform vec3 uColorC;
    uniform float uGlow;
    uniform float uRimWidth;
    uniform float uRimPower;
    uniform float uRimIntensity;
    uniform float uGrain;
    uniform float uOpacity;

    varying vec3 vNormalW;
    varying vec3 vWorldPos;
    varying vec3 vViewDirW;

    float hash(vec3 p) {
      p  = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    void main() {
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(vViewDirW);

      float dotProduct = dot(N, V);

      vec3 lightingN = N;
      if (dotProduct < 0.0) {
        lightingN = -N;
      }

      float ndv = clamp(dot(lightingN, V), 0.0, 1.0);
      float rim = pow(1.0 - ndv, uRimPower);

      float whiteRim = smoothstep(1.0 - uRimWidth, 1.0, rim);

      // Drive the gradient by sphere curvature so color wraps with the orb volume.
      float centerToEdge = 1.0 - ndv;
      float radialGradient = pow(clamp(centerToEdge, 0.0, 1.0), 0.72);
      float hemisphereGradient = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
      float azimuth = atan(N.z, N.x) / 6.28318530718 + 0.5;
      float azimuthWarp = sin(azimuth * 6.28318530718) * 0.045;
      float finalGradient = clamp(mix(hemisphereGradient, radialGradient, 0.72) + azimuthWarp, 0.0, 1.0);

      // Smooth palette crossfades with explicit protection of the center core.
      vec3 cToB = mix(uColorC, uColorB, smoothstep(0.02, 0.52, finalGradient));
      vec3 bToA = mix(uColorB, uColorA, smoothstep(0.30, 0.82, finalGradient));
      vec3 aToC = mix(uColorA, uColorC, pow(smoothstep(0.62, 1.0, finalGradient), 1.25));
      vec3 blendedColor = mix(cToB, bToA, smoothstep(0.22, 0.72, finalGradient));
      blendedColor = mix(blendedColor, aToC, smoothstep(0.68, 0.98, finalGradient));

      // Keep the center decisively lavender/purple, but feather its boundary
      // so it blends into the peach region more smoothly.
      float coreMask = 1.0 - smoothstep(0.06, 0.56, radialGradient);
      float coreOpacity = pow(clamp(coreMask, 0.0, 1.0), 1.7);
      vec3 coreTone = mix(uColorC, uColorB, 0.14);
      blendedColor = mix(blendedColor, coreTone, coreOpacity * 0.9);

      // Pull peach inward with a long soft falloff from the outer/mid body.
      float inwardPeach =
        smoothstep(0.24, 0.92, radialGradient) *
        smoothstep(0.20, 0.88, finalGradient) *
        (1.0 - coreMask);
      blendedColor = mix(blendedColor, uColorB, inwardPeach * 0.28);

      float viewGradient = clamp(dot(lightingN, V) * 0.5 + 0.5, 0.0, 1.0);
      blendedColor = mix(blendedColor, blendedColor * 1.1, viewGradient * 0.3);

      float grain = (hash(vWorldPos * 50.0 + uTime) - 0.5) * uGrain;
      blendedColor += grain;

      vec3 whiteRimCol = vec3(1.0, 0.98, 0.95);
      float rimStrength = whiteRim * uRimIntensity;

      vec3 finalCol = mix(blendedColor, whiteRimCol, rimStrength);
      finalCol += whiteRimCol * whiteRim * 0.2;
      finalCol *= (0.95 + uGlow * 0.05);

      if (dotProduct < 0.0) {
        finalCol *= 0.9;
      }

      gl_FragColor = vec4(finalCol, uOpacity);
    }
  `;

  useEffect(() => {
    if (!mat.current) return;
    mat.current.uniforms.uColorA.value.set(colorA);
    mat.current.uniforms.uColorB.value.set(colorB);
    mat.current.uniforms.uColorC.value.set(colorC);
  }, [colorA, colorB, colorC]);

  useFrame((_, dt) => {
    if (!mat.current) return;
    mat.current.uniforms.uTime.value += dt * 0.5;
  });

  return (
    <mesh {...props}>
      <sphereGeometry args={[1.5, 256, 256]} />
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={vertex}
        fragmentShader={fragment}
        transparent={false}
        depthWrite
        depthTest
        blending={THREE.NormalBlending}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
