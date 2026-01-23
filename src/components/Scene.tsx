"use client";

import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useQualityStore, useDPRClamp } from "@/lib/qualityStore";
import { Orb } from "@/components/Orb";

export function Scene() {
    const initialize = useQualityStore((state) => state.initialize);
    const dprClamp = useDPRClamp();

    useEffect(() => {
        initialize();
    }, [initialize]);

    return (
        <div className="h-full w-full">
            <Canvas
                dpr={[1, dprClamp]}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                camera={{ position: [0, 0, 3], fov: 45 }}
            >
                {/* SDF-based orb with shape morphing support */}
                <Orb />

                {/* Bloom to enhance the glassmorphic effect */}
                <EffectComposer>
                    <Bloom
                        intensity={0.6}
                        luminanceThreshold={0.5}
                        luminanceSmoothing={0.9}
                    />
                </EffectComposer>
            </Canvas>
        </div>
    );
}
