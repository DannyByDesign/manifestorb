"use client";

import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";

export function OrbCanvas() {
    return (
        <div className="h-full w-full">
            <Canvas
                dpr={[1, 2]}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
                camera={{ position: [0, 0, 3], fov: 45 }}
            >
                {/* lighting is optional if you do everything in shaders */}
                <ambientLight intensity={0.5} />

                {/* placeholder */}
                <mesh>
                    <sphereGeometry args={[1, 64, 64]} />
                    <meshStandardMaterial color="white" />
                </mesh>

                <EffectComposer>
                    <Bloom intensity={1.0} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
                </EffectComposer>
            </Canvas>
        </div>
    );
}
