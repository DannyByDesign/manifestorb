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
                <Orb />

                {/* Bloom to enhance the light palette */}
                {/* Bloom to enhance the light palette */}
                {/* <EffectComposer>
                    <Bloom intensity={0.5} luminanceThreshold={0.6} luminanceSmoothing={0.9} />
                </EffectComposer> */}
            </Canvas>
        </div>
    );
}
