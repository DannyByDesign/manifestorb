"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { useQualityStore, useDPRClamp } from "@/lib/stores/qualityStore";

import { Orb } from "@/components/experience/Orb";
import { Sparkles } from "@/components/experience/Sparkles";
import { Effects } from "@/components/experience/Effects";

function ShaderWarmup() {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    let cancelled = false;

    const warm = async () => {
      try {
        const renderer = gl as THREE.WebGLRenderer & {
          compileAsync?: (scene: THREE.Scene, camera: THREE.Camera) => Promise<void>;
        };

        if (renderer.compileAsync) {
          await renderer.compileAsync(scene, camera);
        } else {
          renderer.compile(scene, camera);
        }
      } catch {
        // Warmup is best-effort; rendering can continue without it.
      }

      if (cancelled) return;
    };

    void warm();

    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera]);

  return null;
}

function SceneContent() {
  // Reference parity checklist (kept concise near scene wiring):
  // 1) Stationary centered orb
  // 2) Cohesive multi-speed particle motion (dust/body/glint)
  // 3) High-intent highlights via selective bloom
  // 4) No background palette changes
  return (
    <>
      <ShaderWarmup />
      <Orb />
      <Sparkles />
      <Effects />
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
