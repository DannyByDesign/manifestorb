"use client";

import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

import { useDPRClamp, useQualityStore } from "@/lib/stores/qualityStore";
import { ExternalSparkles2D } from "@/components/experience/orbReference/ExternalSparkles";
import { FBOParticles } from "@/components/experience/orbReference/FboParticles";
import { RimSparkleSphere } from "@/components/experience/orbReference/Sphere";
import {
  simulationFragmentShader,
  simulationVertexShader,
} from "@/components/experience/orbReference/shaders";

type ThemePalette = {
  baseLilac: string;
  coolLavender: string;
  softMauve: string;
  plumMagenta: string;
  warmCoral: string;
  cyanSheen: string;
};

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
  glowBoost?: number;
  colors: [string, string, string, string];
};

const DEFAULT_PALETTE: ThemePalette = {
  baseLilac: "#F4EFF7",
  coolLavender: "#866AD6",
  softMauve: "#DB93D0",
  plumMagenta: "#C55AAA",
  warmCoral: "#F2AA91",
  cyanSheen: "#DDF6FF",
};

const readCssVar = (name: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
};

const mixHex = (a: string, b: string, t: number): string => {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return `#${c.getHexString()}`;
};

function SceneContent({ palette }: { palette: ThemePalette }) {
  const sphereScale = 2.8;

  const derived = useMemo(() => {
    const deepViolet = mixHex(palette.coolLavender, palette.plumMagenta, 0.3);
    const midLavender = mixHex(palette.coolLavender, palette.softMauve, 0.45);
    const paleLilac = mixHex(palette.baseLilac, palette.softMauve, 0.25);
    const iceLavender = mixHex(palette.baseLilac, palette.cyanSheen, 0.35);
    const peachGlow = mixHex(palette.warmCoral, palette.baseLilac, 0.38);
    const rosePeach = mixHex(palette.warmCoral, palette.softMauve, 0.45);
    const whiteBloom = mixHex("#ffffff", palette.baseLilac, 0.35);
    const denseViolet = mixHex(palette.coolLavender, "#45258f", 0.54);
    const orchidLavender = mixHex(palette.softMauve, palette.coolLavender, 0.58);
    const peachMist = mixHex(palette.warmCoral, palette.baseLilac, 0.52);

    return {
      deepViolet,
      midLavender,
      paleLilac,
      iceLavender,
      peachGlow,
      rosePeach,
      whiteBloom,
      denseViolet,
      orchidLavender,
      peachMist,
    };
  }, [palette]);

  const particleConfigs = useMemo<ParticleConfig[]>(
    () => [
      {
        size: 360,
        pointSize: 15.8,
        frequency: 0.45,
        blending: THREE.NormalBlending,
        densityBias: 0.1,
        alphaBase: 0.44,
        alphaBoost: 0.5,
        darkTintMix: 0.78,
        depthFade: 0.33,
        colors: [derived.denseViolet, derived.deepViolet, derived.denseViolet, derived.deepViolet],
      },
      {
        size: 240,
        pointSize: 16.2,
        frequency: 0.48,
        blending: THREE.NormalBlending,
        densityBias: 0.04,
        alphaBase: 0.42,
        alphaBoost: 0.48,
        darkTintMix: 0.7,
        depthFade: 0.31,
        colors: [derived.deepViolet, derived.midLavender, derived.deepViolet, derived.orchidLavender],
      },
      {
        size: 21,
        pointSize: 16.0,
        frequency: 0.3,
        blending: THREE.AdditiveBlending,
        densityBias: -0.1,
        alphaBase: 0.4,
        alphaBoost: 0.44,
        darkTintMix: 0.58,
        depthFade: 0.28,
        glowBoost: 1.36,
        colors: [derived.midLavender, derived.orchidLavender, derived.paleLilac, derived.peachMist],
      },
      {
        size: 7,
        pointSize: 15.9,
        frequency: 0.48,
        blending: THREE.AdditiveBlending,
        densityBias: -0.04,
        alphaBase: 0.38,
        alphaBoost: 0.4,
        darkTintMix: 0.5,
        depthFade: 0.26,
        glowBoost: 1.36,
        colors: [derived.orchidLavender, derived.paleLilac, derived.iceLavender, derived.peachGlow],
      },
    ],
    [derived]
  );

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 5, 7]} intensity={0.8} />
      <pointLight position={[-6, 4, 6]} intensity={0.6} color={derived.paleLilac} />
      <pointLight position={[0, -5, 5]} intensity={0.4} color={derived.rosePeach} />
      <pointLight position={[3, -2, 8]} intensity={0.3} color={derived.iceLavender} />
      <directionalLight position={[-8, 5, 5]} intensity={0.7} color={palette.coolLavender} />

      <group position={[0, 0, 0]} scale={sphereScale}>
        <RimSparkleSphere
          position={[0, 0, 0]}
          renderOrder={20}
          colorA={derived.midLavender}
          colorB={derived.rosePeach}
          colorC={derived.deepViolet}
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
            glowBoost={config.glowBoost ?? 0}
            simVertShader={simulationVertexShader}
            simFragShader={simulationFragmentShader}
          />
        ))}

        <ExternalSparkles2D
          count={3500}
          color1={derived.whiteBloom}
          color2={derived.peachGlow}
          color3={derived.iceLavender}
          circleRadius={1.4}
          mouseInfluenceRadius={0.15}
          mouseRepelStrength={0.1}
          returnSpeed={0.18}
        />
      </group>

      <EffectComposer>
        <Bloom
          intensity={0.36}
          luminanceThreshold={0.38}
          luminanceSmoothing={0.2}
          radius={0.5}
        />
      </EffectComposer>
    </>
  );
}

export function Scene() {
  const initialize = useQualityStore((state) => state.initialize);
  const dprClamp = useDPRClamp();
  const palette = useMemo<ThemePalette>(
    () => ({
      baseLilac: readCssVar("--base-lilac", DEFAULT_PALETTE.baseLilac),
      coolLavender: readCssVar("--cool-lavender", DEFAULT_PALETTE.coolLavender),
      softMauve: readCssVar("--soft-mauve", DEFAULT_PALETTE.softMauve),
      plumMagenta: readCssVar("--plum-magenta", DEFAULT_PALETTE.plumMagenta),
      warmCoral: readCssVar("--warm-coral", DEFAULT_PALETTE.warmCoral),
      cyanSheen: readCssVar("--cyan-sheen", DEFAULT_PALETTE.cyanSheen),
    }),
    []
  );

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="h-full w-full">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 35, near: 0.1, far: 50 }}
        dpr={[1, Math.min(2, dprClamp)]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: true,
          depth: true,
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <SceneContent palette={palette} />
        </Suspense>
      </Canvas>
    </div>
  );
}
