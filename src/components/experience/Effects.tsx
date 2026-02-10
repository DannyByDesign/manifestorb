"use client";

import { EffectComposer, Bloom, Vignette, Noise } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useControls, folder } from "leva";

export function Effects() {
  const isDev = process.env.NODE_ENV === "development";

  const DEFAULTS = {
    bloomIntensity: 0.62,
    bloomLuminanceThreshold: 0.74,
    bloomLuminanceSmoothing: 0.24,
    bloomRadius: 0.55,
    vignetteDarkness: 0.34,
    vignetteOffset: 0.12,
    noiseOpacity: 0.015,
  };

  const devConfig = useControls({
    PostProcessing: folder(
      {
        bloomIntensity: { value: DEFAULTS.bloomIntensity, min: 0, max: 2, step: 0.01 },
        bloomLuminanceThreshold: { value: DEFAULTS.bloomLuminanceThreshold, min: 0, max: 1.5, step: 0.01 },
        bloomLuminanceSmoothing: { value: DEFAULTS.bloomLuminanceSmoothing, min: 0, max: 1, step: 0.01 },
        bloomRadius: { value: DEFAULTS.bloomRadius, min: 0, max: 1, step: 0.01 },
        vignetteDarkness: { value: DEFAULTS.vignetteDarkness, min: 0, max: 1, step: 0.01 },
        vignetteOffset: { value: DEFAULTS.vignetteOffset, min: 0, max: 1, step: 0.01 },
        noiseOpacity: { value: DEFAULTS.noiseOpacity, min: 0, max: 0.1, step: 0.001 },
      },
      { collapsed: true }
    ),
  });

  const config = isDev ? devConfig : DEFAULTS;

  return (
    <EffectComposer>
      <Bloom
        intensity={config.bloomIntensity}
        luminanceThreshold={config.bloomLuminanceThreshold}
        luminanceSmoothing={config.bloomLuminanceSmoothing}
        radius={config.bloomRadius}
      />
      <Vignette
        offset={config.vignetteOffset}
        darkness={config.vignetteDarkness}
        eskil={false}
        blendFunction={BlendFunction.NORMAL}
      />
      <Noise
        premultiply
        blendFunction={BlendFunction.SOFT_LIGHT}
        opacity={config.noiseOpacity}
      />
    </EffectComposer>
  );
}
