"use client";

import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useQualityStore, useDPRClamp } from "@/lib/stores/qualityStore";

import { Orb } from "@/components/experience/Orb";
import { Sparkles } from "@/components/experience/Sparkles";
import { Effects } from "@/components/experience/Effects";

function SceneContent() {
    return (
        <>
            <Orb />
            <Sparkles />
            {/* <Effects /> - Disabled to verify Orb appearance */}
        </>
    );
}

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
                <SceneContent />
            </Canvas>
        </div>
    );
}
