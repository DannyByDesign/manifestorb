"use client";

import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { useQualityStore, useDPRClamp } from "@/lib/qualityStore";

// Test shader import (will be removed after verification)
import noiseShader from "@/shaders/lib/noise.glsl";

export function OrbCanvas() {
    const initialize = useQualityStore((state) => state.initialize);
    const dprClamp = useDPRClamp();

    // Initialize quality detection on mount
    useEffect(() => {
        initialize();

        // Verify shader import works
        if (process.env.NODE_ENV === 'development') {
            console.log('🔷 Shader import test:', noiseShader.includes('snoise') ? '✅ Working' : '❌ Failed');
        }
    }, [initialize]);

    return (
        <div className="h-full w-full">
            <Canvas
                dpr={[1, dprClamp]}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                camera={{ position: [0, 0, 3], fov: 45 }}
            >
                {/* lighting is optional if you do everything in shaders */}
                <ambientLight intensity={0.5} />

                {/* placeholder */}
                <mesh>
                    <sphereGeometry args={[1, 64, 64]} />
                    <meshStandardMaterial color="#f5c6c6" />
                </mesh>

                <EffectComposer>
                    <Bloom intensity={1.0} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
                </EffectComposer>
            </Canvas>
        </div>
    );
}
