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
      float azimuthWarp =
        sin(azimuth * 6.28318530718) * 0.03 +
        sin(azimuth * 12.56637061436 + 0.4) * 0.012;
      float finalGradient = clamp(mix(hemisphereGradient, radialGradient, 0.72) + azimuthWarp, 0.0, 1.0);

      // Smooth, layered transition for a premium center-to-peach blend.
      float coreHold = 1.0 - smoothstep(0.16, 0.54, radialGradient);
      float cToB = smoothstep(0.08, 0.62, finalGradient);
      float bToA = smoothstep(0.34, 0.94, finalGradient);

      vec3 baseBlend = mix(uColorC, uColorB, cToB);
      vec3 peachBlend = mix(baseBlend, uColorA, bToA);
      vec3 coreTint = mix(uColorC, uColorB, 0.22);
      vec3 blendedColor = mix(peachBlend, coreTint, coreHold * 0.85);

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
