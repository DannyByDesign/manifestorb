"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree, extend } from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import { useControls, folder } from "leva";
import { useQualityStore } from "@/lib/stores/qualityStore";

import vertexShader from "@/shaders/orb.vert";
import fragmentShader from "@/shaders/orb.frag";

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

    // Surface effects (legacy)
    uSurfaceNoise: 0.0,
    uNoiseScale: 2.0,
    uNoiseSpeed: 0.3,

    // Enhanced displacement system (OFF by default - only for audio reactivity)
    uDisplacementAmp: 0.0,
    uNoiseOctaves: 1,
    uNoiseFrequency: 1.5,
    uNoiseLacunarity: 2.0,
    uNoisePersistence: 0.5,

    // Flow-based animation (OFF by default - only for audio reactivity)
    uFlowStrength: 0.0,
    uFlowSpeed: 0.0,
    uFlowScale: 1.0,
    uEnableFlow: 0,

    // Audio-reactive (prep for Phase 4)
    uAudioLevel: 0,
    uAudioBass: 0,
    uAudioMid: 0,
    uAudioTreble: 0,

    // Glass properties (visionOS style)
    uIOR: 1.45, // Index of refraction (1.45 = glass)
    uGlassTint: 0.15, // How much base color tints the refraction
    uReflectionStrength: 0.6, // Fresnel reflection intensity
    uGlassClarity: 1.0, // How clear the glass is
    uGlassQuality: 1, // 0=low (mobile), 1=high (desktop)

    // Enhanced glass styling
    uRimIntensity: 0.65, // Fresnel edge/rim glow strength (stronger)
    uFrostiness: 0.4, // Surface roughness/diffusion (center-weighted)
    uEdgeSaturation: 0.55, // Edge saturation/intensity boost (stronger)

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
// Orb Component (SDF Raymarched Volumetric Glass)
// ============================================

export function Orb() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { camera, size, gl } = useThree();
  const tier = useQualityStore((state) => state.tier);

  // Leva debug controls
  const isDev = process.env.NODE_ENV === "development";

  const DEFAULTS = {
    // Glass
    ior: 1.45,
    glassTint: 0.15,
    reflectionStrength: 0.6,
    glassClarity: 1.0,
    rimIntensity: 0.65,
    frostiness: 0.4,
    edgeSaturation: 0.55,
    // Shape
    shapeType: 0,
    morphProgress: 0,
    sphereRadius: 1.0,
    boxWidth: 1.5,
    boxHeight: 1.0,
    boxDepth: 0.15,
    cornerRadius: 0.15,
    // Surface
    displacementAmp: 0.0,
    noiseSpeed: 0.0,
    noiseFrequency: 1.5,
    noiseOctaves: 1,
    lacunarity: 2.0,
    persistence: 0.5,
    enableFlow: false,
    flowStrength: 0.0,
    flowSpeed: 0.0,
    flowScale: 1.0,
    // Audio (Test)
    testAudioLevel: 0,
    testAudioBass: 0,
    testAudioMid: 0,
    testAudioTreble: 0,
  };

  const controls = isDev
    ? useControls({
      Glass: folder(
        {
          ior: {
            value: DEFAULTS.ior,
            min: 1.0,
            max: 2.5,
            step: 0.05,
            label: "IOR (Refraction)",
          },
          glassTint: {
            value: DEFAULTS.glassTint,
            min: 0,
            max: 0.5,
            step: 0.01,
            label: "Glass Tint",
          },
          reflectionStrength: {
            value: DEFAULTS.reflectionStrength,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Reflection",
          },
          glassClarity: {
            value: DEFAULTS.glassClarity,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Clarity",
          },
          rimIntensity: {
            value: DEFAULTS.rimIntensity,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Rim Strength",
          },
          frostiness: {
            value: DEFAULTS.frostiness,
            min: 0,
            max: 0.8,
            step: 0.02,
            label: "Frostiness (center)",
          },
          edgeSaturation: {
            value: DEFAULTS.edgeSaturation,
            min: 0,
            max: 1.0,
            step: 0.02,
            label: "Edge Saturation",
          },
        },
        { collapsed: false }
      ),
      Shape: folder(
        {
          shapeType: {
            value: DEFAULTS.shapeType,
            options: { Sphere: 0, "Rounded Box": 1, Capsule: 2 },
          },
          morphProgress: { value: DEFAULTS.morphProgress, min: 0, max: 1, step: 0.01 },
          sphereRadius: { value: DEFAULTS.sphereRadius, min: 0.5, max: 2.0, step: 0.1 },
          boxWidth: { value: DEFAULTS.boxWidth, min: 0.5, max: 3.0, step: 0.1 },
          boxHeight: { value: DEFAULTS.boxHeight, min: 0.5, max: 2.5, step: 0.1 },
          boxDepth: { value: DEFAULTS.boxDepth, min: 0.05, max: 0.5, step: 0.01 },
          cornerRadius: { value: DEFAULTS.cornerRadius, min: 0, max: 0.5, step: 0.01 },
        },
        { collapsed: true }
      ),
      "Surface (Audio Only)": folder(
        {
          displacementAmp: {
            value: DEFAULTS.displacementAmp,
            min: 0,
            max: 0.08,
            step: 0.002,
            label: "Displacement",
          },
          noiseSpeed: {
            value: DEFAULTS.noiseSpeed,
            min: 0,
            max: 0.2,
            step: 0.01,
            label: "Speed",
          },
          noiseFrequency: {
            value: DEFAULTS.noiseFrequency,
            min: 0.5,
            max: 3.0,
            step: 0.1,
            label: "Frequency",
          },
          noiseOctaves: {
            value: DEFAULTS.noiseOctaves,
            min: 1,
            max: 2,
            step: 1,
            label: "Octaves",
          },
          lacunarity: {
            value: DEFAULTS.lacunarity,
            min: 1.5,
            max: 2.5,
            step: 0.1,
            label: "Lacunarity",
          },
          persistence: {
            value: DEFAULTS.persistence,
            min: 0.3,
            max: 0.7,
            step: 0.05,
            label: "Persistence",
          },
          enableFlow: {
            value: DEFAULTS.enableFlow,
            label: "Enable Flow",
          },
          flowStrength: {
            value: DEFAULTS.flowStrength,
            min: 0,
            max: 0.1,
            step: 0.005,
            label: "Flow Strength",
          },
          flowSpeed: {
            value: DEFAULTS.flowSpeed,
            min: 0,
            max: 0.2,
            step: 0.02,
            label: "Flow Speed",
          },
          flowScale: {
            value: DEFAULTS.flowScale,
            min: 0.5,
            max: 2.0,
            step: 0.1,
            label: "Flow Scale",
          },
        },
        { collapsed: true }
      ),
      "Audio (Test)": folder(
        {
          testAudioLevel: {
            value: DEFAULTS.testAudioLevel,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Level",
          },
          testAudioBass: {
            value: DEFAULTS.testAudioBass,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Bass",
          },
          testAudioMid: {
            value: DEFAULTS.testAudioMid,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Mid",
          },
          testAudioTreble: {
            value: DEFAULTS.testAudioTreble,
            min: 0,
            max: 1,
            step: 0.05,
            label: "Treble",
          },
        },
        { collapsed: true }
      ),
    })
    : DEFAULTS;

  // Create fullscreen quad geometry (clip-space coordinates)
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2);
    return geo;
  }, []);

  // Calculate responsive orb radius based on viewport width
  // Smoothly interpolates from 0.5 (mobile) to 1.0 (desktop)
  const getResponsiveRadius = (viewportWidth: number, baseRadius: number): number => {
    const minWidth = 480;  // Mobile breakpoint
    const maxWidth = 1200; // Desktop breakpoint
    const minRadius = 0.5;
    const maxRadius = baseRadius; // Use Leva value as max

    // Clamp and normalize viewport width to 0-1 range
    const t = Math.max(0, Math.min(1, (viewportWidth - minWidth) / (maxWidth - minWidth)));

    // Smooth easing (ease-out quad) for more natural feel
    const eased = 1 - (1 - t) * (1 - t);

    return minRadius + (maxRadius - minRadius) * eased;
  };

  // Update uniforms every frame
  useFrame((state) => {
    if (!materialRef.current) return;

    const mat = materialRef.current;
    const u = mat.uniforms;

    // Safety check - uniforms might not exist during hot reload
    if (!u.uTime) return;

    // Time
    u.uTime.value = state.clock.getElapsedTime();

    // Resolution (account for DPR)
    const dpr = gl.getPixelRatio();
    u.uResolution.value.set(size.width * dpr, size.height * dpr);

    // Camera uniforms
    u.uCameraPos.value.copy(camera.position);
    u.uInverseProjectionMatrix.value.copy(
      (camera as THREE.PerspectiveCamera).projectionMatrixInverse
    );
    u.uCameraMatrixWorld.value.copy(camera.matrixWorld);

    // Responsive radius - smoothly scales with viewport width
    const responsiveRadius = getResponsiveRadius(size.width, controls.sphereRadius);

    // Shape morphing from Leva
    u.uShapeType.value = controls.shapeType;
    u.uMorphProgress.value = controls.morphProgress;
    u.uSphereRadius.value = responsiveRadius;

    // Scale box dimensions proportionally for rounded box shape
    const scaleFactor = responsiveRadius / controls.sphereRadius;
    u.uShapeDimensions.value.set(
      controls.boxWidth * scaleFactor,
      controls.boxHeight * scaleFactor,
      controls.boxDepth * scaleFactor
    );
    u.uCornerRadius.value = controls.cornerRadius * scaleFactor;

    // Quality tier check (used for multiple optimizations)
    const isMobile = tier.tierName === "mobile";

    // Legacy surface effects (backward compatibility - set to defaults)
    if (u.uSurfaceNoise) u.uSurfaceNoise.value = 0;
    if (u.uNoiseScale) u.uNoiseScale.value = 2.0;
    if (u.uNoiseSpeed) u.uNoiseSpeed.value = controls.noiseSpeed;

    // Enhanced displacement system
    if (u.uDisplacementAmp) u.uDisplacementAmp.value = controls.displacementAmp;

    // Quality-tier aware octaves (mobile gets fewer octaves)
    const maxOctaves = isMobile ? Math.min(controls.noiseOctaves, 2) : controls.noiseOctaves;
    if (u.uNoiseOctaves) u.uNoiseOctaves.value = maxOctaves;

    if (u.uNoiseFrequency) u.uNoiseFrequency.value = controls.noiseFrequency;
    if (u.uNoiseLacunarity) u.uNoiseLacunarity.value = controls.lacunarity;
    if (u.uNoisePersistence) u.uNoisePersistence.value = controls.persistence;

    // Flow-based animation
    if (u.uFlowStrength) u.uFlowStrength.value = controls.flowStrength;
    if (u.uFlowSpeed) u.uFlowSpeed.value = controls.flowSpeed;
    if (u.uFlowScale) u.uFlowScale.value = controls.flowScale;
    if (u.uEnableFlow) u.uEnableFlow.value = controls.enableFlow ? 1 : 0;

    // Audio-reactive (test values from Leva, will be replaced by useAudio hook in Phase 4)
    if (u.uAudioLevel) u.uAudioLevel.value = controls.testAudioLevel;
    if (u.uAudioBass) u.uAudioBass.value = controls.testAudioBass;
    if (u.uAudioMid) u.uAudioMid.value = controls.testAudioMid;
    if (u.uAudioTreble) u.uAudioTreble.value = controls.testAudioTreble;

    // Glass properties from Leva (with safety checks for hot reload)
    if (u.uIOR) u.uIOR.value = controls.ior;
    if (u.uGlassTint) u.uGlassTint.value = controls.glassTint;
    if (u.uReflectionStrength) u.uReflectionStrength.value = controls.reflectionStrength;
    if (u.uGlassClarity) u.uGlassClarity.value = controls.glassClarity;

    // Enhanced glass styling from Leva
    if (u.uRimIntensity) u.uRimIntensity.value = controls.rimIntensity;
    if (u.uFrostiness) u.uFrostiness.value = controls.frostiness;
    if (u.uEdgeSaturation) u.uEdgeSaturation.value = controls.edgeSaturation;

    // Quality tier - affects both raymarch steps and glass quality
    u.uMaxSteps.value = isMobile ? 32 : 64;
    if (u.uGlassQuality) u.uGlassQuality.value = isMobile ? 0 : 1;

    // Sync colors from CSS variables
    u.uBaseColor.value = getCssColor("--orb-base", "#E7E4F2");
    u.uCoolColor.value = getCssColor("--orb-cool", "#E0EEF1");
    u.uWarmColor.value = getCssColor("--orb-warm", "#D8919B");
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
