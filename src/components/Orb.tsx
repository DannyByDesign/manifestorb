"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree, extend } from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import { useControls, folder } from "leva";
import { useQualityStore } from "@/lib/qualityStore";

import vertexShader from "@/shaders/orb-sdf.vert";
import fragmentShader from "@/shaders/orb-sdf.frag";

// ============================================
// CSS Color Helper
// ============================================

const getCssColor = (varName: string, fallback: string = "#ffffff") => {
  if (typeof window === "undefined") return new THREE.Color(fallback);
  const style = getComputedStyle(document.body);
  const colorStr = style.getPropertyValue(varName).trim();
  if (!colorStr) return new THREE.Color(fallback);
  return new THREE.Color(colorStr);
};

// ============================================
// Shader Material Definition
// ============================================

const OrbMaterialImpl = shaderMaterial(
  {
    // Time & Resolution
    uTime: 0,
    uResolution: new THREE.Vector2(1, 1),

    // Camera
    uCameraPos: new THREE.Vector3(0, 0, 3),
    uInverseProjectionMatrix: new THREE.Matrix4(),
    uCameraMatrixWorld: new THREE.Matrix4(),

    // Shape morphing
    uShapeType: 0, // 0=sphere, 1=roundedBox, 2=capsule
    uMorphProgress: 0.0,
    uShapeDimensions: new THREE.Vector3(1.2, 0.9, 0.15), // half-extents for box
    uCornerRadius: 0.15,
    uSphereRadius: 1.0,

    // Surface effects
    uSurfaceNoise: 0.0,
    uNoiseScale: 2.0,
    uNoiseSpeed: 0.3,

    // Colors
    uBaseColor: new THREE.Color(0xe7e4f2),
    uCoolColor: new THREE.Color(0xe0eef1),
    uWarmColor: new THREE.Color(0xd8919b),

    // Quality
    uMaxSteps: 64,
  },
  vertexShader,
  fragmentShader
);

extend({ OrbMaterial: OrbMaterialImpl });

// TypeScript declaration for the extended material
declare global {
  namespace JSX {
    interface IntrinsicElements {
      orbMaterial: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          ref?: React.Ref<THREE.ShaderMaterial>;
          transparent?: boolean;
          depthWrite?: boolean;
          depthTest?: boolean;
        },
        HTMLElement
      >;
    }
  }
}

// ============================================
// Orb Component (SDF Raymarched)
// ============================================

export function Orb() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { camera, size, gl } = useThree();
  const tier = useQualityStore((state) => state.tier);

  // Leva debug controls
  const controls = useControls({
    Shape: folder({
      shapeType: {
        value: 0,
        options: { Sphere: 0, "Rounded Box": 1, Capsule: 2 },
      },
      morphProgress: { value: 0, min: 0, max: 1, step: 0.01 },
      sphereRadius: { value: 1.0, min: 0.5, max: 2.0, step: 0.1 },
      boxWidth: { value: 1.5, min: 0.5, max: 3.0, step: 0.1 },
      boxHeight: { value: 1.0, min: 0.5, max: 2.5, step: 0.1 },
      boxDepth: { value: 0.15, min: 0.05, max: 0.5, step: 0.01 },
      cornerRadius: { value: 0.15, min: 0, max: 0.5, step: 0.01 },
    }),
    Surface: folder({
      surfaceNoise: { value: 0.0, min: 0, max: 0.15, step: 0.005 },
      noiseScale: { value: 2.0, min: 0.5, max: 5.0, step: 0.1 },
      noiseSpeed: { value: 0.3, min: 0, max: 1.0, step: 0.05 },
    }),
  });

  // Create fullscreen quad geometry (clip-space coordinates)
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2);
    return geo;
  }, []);

  // Update uniforms every frame
  useFrame((state) => {
    if (!materialRef.current) return;

    const mat = materialRef.current;

    // Time
    mat.uniforms.uTime.value = state.clock.getElapsedTime();

    // Resolution (account for DPR)
    const dpr = gl.getPixelRatio();
    mat.uniforms.uResolution.value.set(size.width * dpr, size.height * dpr);

    // Camera uniforms
    mat.uniforms.uCameraPos.value.copy(camera.position);
    mat.uniforms.uInverseProjectionMatrix.value.copy(
      (camera as THREE.PerspectiveCamera).projectionMatrixInverse
    );
    mat.uniforms.uCameraMatrixWorld.value.copy(camera.matrixWorld);

    // Shape morphing from Leva
    mat.uniforms.uShapeType.value = controls.shapeType;
    mat.uniforms.uMorphProgress.value = controls.morphProgress;
    mat.uniforms.uSphereRadius.value = controls.sphereRadius;
    mat.uniforms.uShapeDimensions.value.set(
      controls.boxWidth,
      controls.boxHeight,
      controls.boxDepth
    );
    mat.uniforms.uCornerRadius.value = controls.cornerRadius;

    // Surface effects
    mat.uniforms.uSurfaceNoise.value = controls.surfaceNoise;
    mat.uniforms.uNoiseScale.value = controls.noiseScale;
    mat.uniforms.uNoiseSpeed.value = controls.noiseSpeed;

    // Quality tier
    mat.uniforms.uMaxSteps.value = tier.tierName === "mobile" ? 32 : 64;

    // Sync colors from CSS variables
    mat.uniforms.uBaseColor.value = getCssColor("--orb-base", "#E7E4F2");
    mat.uniforms.uCoolColor.value = getCssColor("--orb-cool", "#E0EEF1");
    mat.uniforms.uWarmColor.value = getCssColor("--orb-warm", "#D8919B");
  });

  return (
    <mesh
      geometry={geometry}
      frustumCulled={false}
      renderOrder={-1} // Render before other objects
    >
      {/* @ts-ignore - R3F extended material */}
      <orbMaterial
        ref={materialRef}
        transparent={true}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

