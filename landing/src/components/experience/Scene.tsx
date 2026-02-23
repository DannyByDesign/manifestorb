"use client";

import { Suspense, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

import { useDPRClamp, useQualityStore } from "@/lib/stores/qualityStore";
import { ExternalSparkles2D } from "@/components/experience/orbReference/ExternalSparkles";
import { RimSparkleSphere } from "@/components/experience/orbReference/Sphere";

function SceneContent() {
  const sphereScale = 4.4;
  const viewport = useThree((state) => state.viewport);
  const sphereRadius = 1.5 * sphereScale;
  const visibleFraction = 1 / 3;
  const visibleHeight = sphereRadius * 2 * visibleFraction;
  const lowerNudge = 1.3;
  const orbOffsetY = -viewport.height / 2 + visibleHeight - sphereRadius - lowerNudge;

  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 5, 7]} intensity={0.8} />
      <pointLight position={[-6, 4, 6]} intensity={0.6} color="#EEDDEE" />
      <pointLight position={[0, -5, 5]} intensity={0.4} color="#E8A0B1" />
      <pointLight position={[3, -2, 8]} intensity={0.3} color="#ECF1FA" />
      <directionalLight position={[-8, 5, 5]} intensity={0.7} color="#866AD6" />

      <group position={[0, orbOffsetY, 0]} scale={sphereScale}>
        <RimSparkleSphere
          position={[0, 0, 0]}
          renderOrder={20}
          colorA="#B37FD3"
          colorB="#E8A0B1"
          colorC="#9C66CA"
        />

        <ExternalSparkles2D
          count={3500}
          color1="#FBFAFC"
          color2="#F3C8C0"
          color3="#ECF1FA"
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

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <div className="h-full w-full landing-scene-enter">
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
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
