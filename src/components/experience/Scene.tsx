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
  cyanSheen: string;
};

const DEFAULT_PALETTE: ThemePalette = {
  baseLilac: "#EDE8F2",
  coolLavender: "#887DAD",
  softMauve: "#C69BBB",
  plumMagenta: "#B86698",
  cyanSheen: "#E0EEF1",
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
    const whiteBloom = mixHex("#ffffff", palette.baseLilac, 0.35);

    return {
      deepViolet,
      midLavender,
      paleLilac,
      iceLavender,
      whiteBloom,
    };
  }, [palette]);

  const particleConfigs = useMemo(
    () => [
      {
        size: 456,
        pointSize: 16.2,
        frequency: 0.45,
        blending: THREE.NormalBlending,
        densityBias: 0.2,
        alphaBase: 0.56,
        alphaBoost: 0.66,
        darkTintMix: 0.78,
        glintChance: 0.01,
        depthFade: 0.3,
        colors: [derived.deepViolet, palette.coolLavender, palette.softMauve, palette.plumMagenta],
      },
      {
        size: 296,
        pointSize: 16.8,
        frequency: 0.48,
        blending: THREE.NormalBlending,
        densityBias: 0.15,
        alphaBase: 0.54,
        alphaBoost: 0.62,
        darkTintMix: 0.72,
        glintChance: 0.014,
        depthFade: 0.28,
        colors: [palette.coolLavender, palette.softMauve, derived.midLavender, derived.paleLilac],
      },
      {
        size: 158,
        pointSize: 16.5,
        frequency: 0.56,
        blending: THREE.NormalBlending,
        densityBias: 0.09,
        alphaBase: 0.5,
        alphaBoost: 0.54,
        darkTintMix: 0.64,
        glintChance: 0.02,
        depthFade: 0.25,
        colors: [derived.midLavender, derived.paleLilac, palette.baseLilac, palette.coolLavender],
      },
      {
        size: 96,
        pointSize: 16.8,
        frequency: 1.65,
        blending: THREE.NormalBlending,
        densityBias: 0.04,
        alphaBase: 0.48,
        alphaBoost: 0.48,
        darkTintMix: 0.56,
        glintChance: 0.03,
        depthFade: 0.22,
        colors: [derived.paleLilac, derived.iceLavender, palette.cyanSheen, palette.softMauve],
      },
      {
        size: 94,
        pointSize: 16.2,
        frequency: 0.7,
        blending: THREE.NormalBlending,
        densityBias: 0.06,
        alphaBase: 0.48,
        alphaBoost: 0.5,
        darkTintMix: 0.58,
        glintChance: 0.03,
        depthFade: 0.24,
        colors: [palette.softMauve, derived.midLavender, derived.paleLilac, derived.iceLavender],
      },
      {
        size: 88,
        pointSize: 17.0,
        frequency: 2.3,
        blending: THREE.AdditiveBlending,
        densityBias: 0.0,
        alphaBase: 0.38,
        alphaBoost: 0.42,
        darkTintMix: 0.34,
        glintChance: 0.06,
        depthFade: 0.2,
        colors: [derived.iceLavender, palette.cyanSheen, derived.whiteBloom, derived.paleLilac],
      },
      {
        size: 28,
        pointSize: 13.8,
        frequency: 2.8,
        blending: THREE.AdditiveBlending,
        densityBias: -0.08,
        alphaBase: 0.34,
        alphaBoost: 0.38,
        darkTintMix: 0.2,
        glintChance: 0.11,
        depthFade: 0.18,
        colors: [derived.whiteBloom, "#FFFFFF", derived.iceLavender, palette.baseLilac],
      },
    ],
    [derived, palette]
  );

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 5, 7]} intensity={0.8} />
      <pointLight position={[-6, 4, 6]} intensity={0.6} color={derived.paleLilac} />
      <pointLight position={[0, -5, 5]} intensity={0.4} />
      <pointLight position={[3, -2, 8]} intensity={0.3} color={derived.iceLavender} />
      <directionalLight position={[-8, 5, 5]} intensity={0.7} color={palette.coolLavender} />

      <group position={[0, 0, 0]} scale={sphereScale}>
        <RimSparkleSphere
          position={[0, 0, 0]}
          colorA={derived.paleLilac}
          colorB={palette.softMauve}
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
            glintChance={config.glintChance}
            depthFade={config.depthFade}
            simVertShader={simulationVertexShader}
            simFragShader={simulationFragmentShader}
          />
        ))}

        <ExternalSparkles2D
          count={3500}
          color1={derived.whiteBloom}
          color2="#FFFFFF"
          color3={derived.iceLavender}
          circleRadius={1.4}
          mouseInfluenceRadius={0.5}
          mouseRepelStrength={0.25}
          returnSpeed={0.18}
        />
      </group>

      <EffectComposer>
        <Bloom
          intensity={0.52}
          luminanceThreshold={0.28}
          luminanceSmoothing={0.18}
          radius={0.62}
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
