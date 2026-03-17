"use client";

import { Suspense, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

import { ExternalSparkles2D } from "@/components/experience/orbReference/ExternalSparkles";
import { FBOParticles } from "@/components/experience/orbReference/FboParticles";
import { RimSparkleSphere } from "@/components/experience/orbReference/Sphere";
import {
  simulationFragmentShader,
  simulationVertexShader,
} from "@/components/experience/orbReference/shaders";
import { SCENE_VISUAL_CONFIG } from "@/lib/capabilities";

type ParticleConfig = {
  size: number;
  pointSize: number;
  frequency: number;
  blending: THREE.Blending;
  densityBias: number;
  alphaBase: number;
  alphaBoost: number;
  darkTintMix: number;
  depthFade: number;
  clumpFlatten?: number;
  fieldMode?: number;
  glowBoost?: number;
  outerGlowMirror?: number;
  colorBoost?: number;
  colors: [string, string, string, string];
};

const PARTICLE_CONFIGS: ParticleConfig[] = [
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[0],
    pointSize: 18,
    frequency: 0.24,
    blending: THREE.NormalBlending,
    densityBias: 0.1,
    alphaBase: 0.44,
    alphaBoost: 0.5,
    darkTintMix: 0.78,
    depthFade: 0.33,
    colorBoost: 0.4,
    colors: ["#694EB4", "#9C66CA", "#694EB4", "#9C66CA"],
  },
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[1],
    pointSize: 18,
    frequency: 0.26,
    blending: THREE.NormalBlending,
    densityBias: 0.02,
    alphaBase: 0.45,
    alphaBoost: 0.48,
    darkTintMix: 0.7,
    depthFade: 0.31,
    colorBoost: 0.48,
    colors: ["#4C13EB", "#8A13F0", "#4C13EB", "#8A13F0"],
  },
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[2],
    pointSize: 24,
    frequency: 0.48,
    blending: THREE.AdditiveBlending,
    densityBias: -0.55,
    alphaBase: 0.4,
    alphaBoost: 0.44,
    darkTintMix: 0.58,
    depthFade: 0.28,
    clumpFlatten: 1.0,
    fieldMode: 1,
    glowBoost: 1.36,
    outerGlowMirror: 1.0,
    colorBoost: 0.32,
    colors: ["#B37FD3", "#B07DD4", "#EEDDEE", "#F3D2CE"],
  },
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[3],
    pointSize: 15,
    frequency: 0.38,
    blending: THREE.AdditiveBlending,
    densityBias: -0.55,
    alphaBase: 0.38,
    alphaBoost: 0.4,
    darkTintMix: 0.5,
    depthFade: 0.26,
    clumpFlatten: 1.0,
    fieldMode: 1,
    glowBoost: 1.36,
    outerGlowMirror: 1.0,
    colorBoost: 0.36,
    colors: ["#B07DD4", "#EEDDEE", "#ECF1FA", "#F3C8C0"],
  },
];

function SceneContent() {
  const sphereScale = 2.5;

  const particleConfigs = useMemo(() => PARTICLE_CONFIGS, []);

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 5, 7]} intensity={0.8} />
      <pointLight position={[-6, 4, 6]} intensity={0.6} color="#EEDDEE" />
      <pointLight position={[0, -5, 5]} intensity={0.4} color="#E8A0B1" />
      <pointLight position={[3, -2, 8]} intensity={0.3} color="#ECF1FA" />
      <directionalLight position={[-8, 5, 5]} intensity={0.7} color="#866AD6" />

      <group position={[0, 0, 0]} scale={sphereScale}>
        <RimSparkleSphere
          position={[0, 0, 0]}
          renderOrder={20}
          colorA="#B37FD3"
          colorB="#E8A0B1"
          colorC="#9C66CA"
          segments={SCENE_VISUAL_CONFIG.sphereSegments}
        />

        {particleConfigs.map((config) => (
          <FBOParticles
            key={`${config.size}-${config.frequency}`}
            size={config.size}
            pointSize={config.pointSize}
            frequency={config.frequency}
            color1={config.colors[0]}
            color2={config.colors[1]}
            color3={config.colors[2]}
            color4={config.colors[3]}
            blending={config.blending}
            densityBias={config.densityBias}
            alphaBase={config.alphaBase}
            alphaBoost={config.alphaBoost}
            darkTintMix={config.darkTintMix}
            depthFade={config.depthFade}
            clumpFlatten={config.clumpFlatten ?? 0}
            fieldMode={config.fieldMode ?? 0}
            glowBoost={config.glowBoost ?? 0}
            outerGlowMirror={config.outerGlowMirror ?? 0}
            colorBoost={config.colorBoost ?? 0}
            simVertShader={simulationVertexShader}
            simFragShader={simulationFragmentShader}
          />
        ))}

        <ExternalSparkles2D
          count={SCENE_VISUAL_CONFIG.outerSparkleCount}
          color1="#FBFAFC"
          color2="#F3C8C0"
          color3="#ECF1FA"
          circleRadius={1.4}
          mouseInfluenceRadius={0.15}
          mouseRepelStrength={0.1}
          returnSpeed={0.18}
        />
      </group>

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={SCENE_VISUAL_CONFIG.bloom.intensity}
          luminanceThreshold={SCENE_VISUAL_CONFIG.bloom.luminanceThreshold}
          luminanceSmoothing={SCENE_VISUAL_CONFIG.bloom.luminanceSmoothing}
          radius={SCENE_VISUAL_CONFIG.bloom.radius}
        />
      </EffectComposer>
    </>
  );
}

export function Scene() {
  return (
    <div className="h-full w-full">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 35, near: 0.1, far: 50 }}
        dpr={SCENE_VISUAL_CONFIG.dpr}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          depth: true,
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
