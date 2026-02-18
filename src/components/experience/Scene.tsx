"use client";

import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

import { useDPRClamp, useQualityStore } from "@/lib/stores/qualityStore";
import { ExternalSparkles2D } from "@/components/experience/orbReference/ExternalSparkles";
import { FBOParticles } from "@/components/experience/orbReference/FboParticles";
import { type ParticleProfile } from "@/components/experience/orbReference/particleProfile";
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
    const inkyViolet = mixHex(palette.coolLavender, "#251a45", 0.62);
    const plasmaViolet = mixHex(palette.plumMagenta, "#5f42cf", 0.45);
    const royalViolet = mixHex(palette.coolLavender, "#5d43b8", 0.52);
    const deepViolet = mixHex(palette.coolLavender, palette.plumMagenta, 0.3);
    const midLavender = mixHex(palette.coolLavender, palette.softMauve, 0.45);
    const paleLilac = mixHex(palette.baseLilac, palette.softMauve, 0.25);
    const iceLavender = mixHex(palette.baseLilac, palette.cyanSheen, 0.35);
    const whiteBloom = mixHex("#ffffff", palette.baseLilac, 0.35);
    const brightLilac = mixHex(palette.baseLilac, "#ffffff", 0.42);

    return {
      inkyViolet,
      plasmaViolet,
      royalViolet,
      deepViolet,
      midLavender,
      paleLilac,
      iceLavender,
      whiteBloom,
      brightLilac,
    };
  }, [palette]);

  type ParticleLayerConfig = {
    size: number;
    pointSize: number;
    frequency: number;
    blending: THREE.Blending;
    colors: [string, string, string, string];
    profile: Partial<ParticleProfile>;
  };

  const particleConfigs = useMemo(
    (): ParticleLayerConfig[] => [
      {
        size: 456,
        pointSize: 16.9,
        frequency: 0.45,
        blending: THREE.NormalBlending,
        colors: [derived.inkyViolet, derived.royalViolet, palette.softMauve, derived.deepViolet],
        profile: {
          seed: 0.11,
          spawnCore: 0.62,
          spawnShell: 0.28,
          lobeBias: 0.78,
          radialTightness: 0.82,
          edgeScatter: 0.25,
          driftStrength: 0.88,
          turbulenceStrength: 0.62,
          shearStrength: 0.58,
          breathStrength: 0.32,
          compression: 0.7,
          confinement: 0.88,
          curlMix: 0.52,
          densityBias: 0.22,
          alphaBase: 0.6,
          alphaBoost: 0.78,
          darkTintMix: 0.82,
          glintChance: 0.01,
          depthFade: 0.34,
        },
      },
      {
        size: 296,
        pointSize: 17.5,
        frequency: 0.48,
        blending: THREE.NormalBlending,
        colors: [derived.deepViolet, palette.coolLavender, derived.midLavender, derived.plasmaViolet],
        profile: {
          seed: 0.23,
          spawnCore: 0.54,
          spawnShell: 0.35,
          lobeBias: 0.72,
          radialTightness: 0.74,
          edgeScatter: 0.35,
          driftStrength: 0.84,
          turbulenceStrength: 0.7,
          shearStrength: 0.62,
          breathStrength: 0.26,
          compression: 0.62,
          confinement: 0.84,
          curlMix: 0.58,
          densityBias: 0.16,
          alphaBase: 0.57,
          alphaBoost: 0.66,
          darkTintMix: 0.72,
          glintChance: 0.014,
          depthFade: 0.28,
        },
      },
      {
        size: 158,
        pointSize: 17.0,
        frequency: 0.56,
        blending: THREE.NormalBlending,
        colors: [derived.royalViolet, derived.midLavender, derived.paleLilac, palette.coolLavender],
        profile: {
          seed: 0.37,
          spawnCore: 0.44,
          spawnShell: 0.46,
          lobeBias: 0.62,
          radialTightness: 0.62,
          edgeScatter: 0.5,
          driftStrength: 0.8,
          turbulenceStrength: 0.78,
          shearStrength: 0.66,
          breathStrength: 0.22,
          compression: 0.56,
          confinement: 0.82,
          curlMix: 0.64,
          densityBias: 0.08,
          alphaBase: 0.54,
          alphaBoost: 0.6,
          darkTintMix: 0.64,
          glintChance: 0.02,
          depthFade: 0.24,
        },
      },
      {
        size: 96,
        pointSize: 17.5,
        frequency: 1.65,
        blending: THREE.NormalBlending,
        colors: [derived.midLavender, derived.paleLilac, derived.iceLavender, palette.cyanSheen],
        profile: {
          seed: 0.49,
          spawnCore: 0.34,
          spawnShell: 0.5,
          lobeBias: 0.54,
          radialTightness: 0.52,
          edgeScatter: 0.62,
          driftStrength: 0.74,
          turbulenceStrength: 0.86,
          shearStrength: 0.7,
          breathStrength: 0.18,
          compression: 0.48,
          confinement: 0.8,
          curlMix: 0.7,
          densityBias: 0.03,
          alphaBase: 0.5,
          alphaBoost: 0.48,
          darkTintMix: 0.52,
          glintChance: 0.026,
          depthFade: 0.22,
        },
      },
      {
        size: 94,
        pointSize: 17.0,
        frequency: 0.7,
        blending: THREE.NormalBlending,
        colors: [derived.deepViolet, palette.softMauve, derived.paleLilac, derived.iceLavender],
        profile: {
          seed: 0.58,
          spawnCore: 0.4,
          spawnShell: 0.44,
          lobeBias: 0.6,
          radialTightness: 0.58,
          edgeScatter: 0.58,
          driftStrength: 0.76,
          turbulenceStrength: 0.8,
          shearStrength: 0.62,
          breathStrength: 0.18,
          compression: 0.52,
          confinement: 0.8,
          curlMix: 0.65,
          densityBias: 0.06,
          alphaBase: 0.5,
          alphaBoost: 0.54,
          darkTintMix: 0.58,
          glintChance: 0.03,
          depthFade: 0.24,
        },
      },
      {
        size: 88,
        pointSize: 17.5,
        frequency: 2.3,
        blending: THREE.AdditiveBlending,
        colors: [derived.plasmaViolet, derived.iceLavender, derived.brightLilac, "#ffffff"],
        profile: {
          seed: 0.71,
          spawnCore: 0.28,
          spawnShell: 0.52,
          lobeBias: 0.46,
          radialTightness: 0.44,
          edgeScatter: 0.74,
          driftStrength: 0.64,
          turbulenceStrength: 0.92,
          shearStrength: 0.74,
          breathStrength: 0.14,
          compression: 0.38,
          confinement: 0.78,
          curlMix: 0.74,
          densityBias: -0.03,
          alphaBase: 0.45,
          alphaBoost: 0.42,
          darkTintMix: 0.36,
          glintChance: 0.06,
          depthFade: 0.2,
        },
      },
      {
        size: 28,
        pointSize: 15.0,
        frequency: 2.8,
        blending: THREE.AdditiveBlending,
        colors: [derived.whiteBloom, "#FFFFFF", derived.brightLilac, derived.iceLavender],
        profile: {
          seed: 0.89,
          spawnCore: 0.2,
          spawnShell: 0.45,
          lobeBias: 0.34,
          radialTightness: 0.32,
          edgeScatter: 0.85,
          driftStrength: 0.58,
          turbulenceStrength: 1.02,
          shearStrength: 0.78,
          breathStrength: 0.1,
          compression: 0.28,
          confinement: 0.72,
          curlMix: 0.82,
          densityBias: -0.08,
          alphaBase: 0.4,
          alphaBoost: 0.38,
          darkTintMix: 0.2,
          glintChance: 0.12,
          depthFade: 0.18,
        },
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
            profile={config.profile}
            color1={config.colors[0]}
            color2={config.colors[1]}
            color3={config.colors[2]}
            color4={config.colors[3]}
            blending={config.blending}
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
          intensity={0.4}
          luminanceThreshold={0.15}
          luminanceSmoothing={0.4}
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
