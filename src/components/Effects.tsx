"use client";

import { useThree } from "@react-three/fiber";
import { EffectComposer, Vignette, Noise } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useControls, folder } from "leva";

export function Effects() {
    const { gl } = useThree();

    // Leva controls for fine-tuning the look
    const isDev = process.env.NODE_ENV === "development";

    const DEFAULTS = {
        // Vignette
        vignetteDarkness: 0.5,
        vignetteOffset: 0.1,
        // Noise
        noiseOpacity: 0.05,
    };

    const config = isDev
        ? useControls({
            PostProcessing: folder(
                {
                    vignetteDarkness: { value: DEFAULTS.vignetteDarkness, min: 0, max: 1, step: 0.01 },
                    vignetteOffset: { value: DEFAULTS.vignetteOffset, min: 0, max: 1, step: 0.01 },
                    noiseOpacity: { value: DEFAULTS.noiseOpacity, min: 0, max: 0.2, step: 0.005 },
                },
                { collapsed: true }
            ),
        })
        : DEFAULTS;

    return (
        <EffectComposer>
            <Vignette
                offset={config.vignetteOffset}
                darkness={config.vignetteDarkness}
                eskil={false}
                blendFunction={BlendFunction.NORMAL}
            />
            <Noise
                premultiply
                blendFunction={BlendFunction.OVERLAY}
                opacity={config.noiseOpacity}
            />
        </EffectComposer>
    );
}
