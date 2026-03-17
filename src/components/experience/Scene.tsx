"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";

import { ExternalSparkles2D } from "@/components/experience/orbReference/ExternalSparkles";
import { FBOParticles } from "@/components/experience/orbReference/FboParticles";
import { RimSparkleSphere } from "@/components/experience/orbReference/Sphere";
import {
  detectCapabilities,
  logCapabilities,
  SCENE_VISUAL_CONFIG,
} from "@/lib/capabilities";

type ParticleConfig = {
  size: number;
  pointSize: number;
  frequency: number;
  blending: THREE.Blending;
  densityBias: number;
  alphaBase: number;
  alphaBoost: number;
  darkTintMix: number;
  depthFade: number;
  clumpFlatten?: number;
  fieldMode?: number;
  glowBoost?: number;
  outerGlowMirror?: number;
  colorBoost?: number;
  colors: [string, string, string, string];
};

const PARTICLE_CONFIGS: ParticleConfig[] = [
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[0],
    pointSize: 18,
    frequency: 0.24,
    blending: THREE.NormalBlending,
    densityBias: 0.1,
    alphaBase: 0.44,
    alphaBoost: 0.5,
    darkTintMix: 0.78,
    depthFade: 0.33,
    colorBoost: 0.4,
    colors: ["#694EB4", "#9C66CA", "#694EB4", "#9C66CA"],
  },
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[1],
    pointSize: 18,
    frequency: 0.26,
    blending: THREE.NormalBlending,
    densityBias: 0.02,
    alphaBase: 0.45,
    alphaBoost: 0.48,
    darkTintMix: 0.7,
    depthFade: 0.31,
    colorBoost: 0.48,
    colors: ["#4C13EB", "#8A13F0", "#4C13EB", "#8A13F0"],
  },
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[2],
    pointSize: 24,
    frequency: 0.48,
    blending: THREE.AdditiveBlending,
    densityBias: -0.55,
    alphaBase: 0.4,
    alphaBoost: 0.44,
    darkTintMix: 0.58,
    depthFade: 0.28,
    clumpFlatten: 1.0,
    fieldMode: 1,
    glowBoost: 1.36,
    outerGlowMirror: 1.0,
    colorBoost: 0.32,
    colors: ["#B37FD3", "#B07DD4", "#EEDDEE", "#F3D2CE"],
  },
  {
    size: SCENE_VISUAL_CONFIG.innerParticleLayerSizes[3],
    pointSize: 15,
    frequency: 0.38,
    blending: THREE.AdditiveBlending,
    densityBias: -0.55,
    alphaBase: 0.38,
    alphaBoost: 0.4,
    darkTintMix: 0.5,
    depthFade: 0.26,
    clumpFlatten: 1.0,
    fieldMode: 1,
    glowBoost: 1.36,
    outerGlowMirror: 1.0,
    colorBoost: 0.36,
    colors: ["#B07DD4", "#EEDDEE", "#ECF1FA", "#F3C8C0"],
  },
];

type ViewState = "intro" | "revealed";

type ScenePose = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

type CameraPose = {
  position: [number, number, number];
  fov: number;
};

type SceneProps = {
  viewState?: ViewState;
  reducedMotion?: boolean;
};

const REVEALED_POSE: ScenePose = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 2.5,
};

const INTRO_POSE: ScenePose = {
  position: [0, -7.75, 1.4],
  rotation: [-0.02, 0.03, 0],
  scale: 3.55,
};

const REVEALED_CAMERA: CameraPose = {
  position: [0, 0, 15],
  fov: 35,
};

const INTRO_CAMERA: CameraPose = {
  position: [0, 0.55, 14],
  fov: 40,
};

function SceneRig({
  viewState,
  reducedMotion,
  children,
}: React.PropsWithChildren<{
  viewState: ViewState;
  reducedMotion: boolean;
}>) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const targetPose = viewState === "revealed" ? REVEALED_POSE : INTRO_POSE;
  const targetCamera = viewState === "revealed" ? REVEALED_CAMERA : INTRO_CAMERA;
  const hasInitialisedRef = useRef(false);

  useEffect(() => {
    cameraRef.current = camera as THREE.PerspectiveCamera;
  }, [camera]);

  useEffect(() => {
    if (hasInitialisedRef.current || !groupRef.current || !cameraRef.current) return;

    groupRef.current.position.set(...targetPose.position);
    groupRef.current.rotation.set(...targetPose.rotation);
    groupRef.current.scale.setScalar(targetPose.scale);
    cameraRef.current.position.set(...targetCamera.position);
    cameraRef.current.fov = targetCamera.fov;
    cameraRef.current.updateProjectionMatrix();
    hasInitialisedRef.current = true;
  }, [targetCamera, targetPose]);

  useEffect(() => {
    if (!reducedMotion || !groupRef.current || !cameraRef.current) return;

    groupRef.current.position.set(...targetPose.position);
    groupRef.current.rotation.set(...targetPose.rotation);
    groupRef.current.scale.setScalar(targetPose.scale);
    cameraRef.current.position.set(...targetCamera.position);
    cameraRef.current.fov = targetCamera.fov;
    cameraRef.current.updateProjectionMatrix();
  }, [reducedMotion, targetCamera, targetPose]);

  useFrame((_, delta) => {
    if (!groupRef.current || !cameraRef.current || reducedMotion) return;

    const activeCamera = cameraRef.current;

    const movementDamping = 4.6;
    const cameraDamping = 4.1;
    groupRef.current.position.x = THREE.MathUtils.damp(
      groupRef.current.position.x,
      targetPose.position[0],
      movementDamping,
      delta
    );
    groupRef.current.position.y = THREE.MathUtils.damp(
      groupRef.current.position.y,
      targetPose.position[1],
      movementDamping,
      delta
    );
    groupRef.current.position.z = THREE.MathUtils.damp(
      groupRef.current.position.z,
      targetPose.position[2],
      movementDamping,
      delta
    );
    groupRef.current.rotation.x = THREE.MathUtils.damp(
      groupRef.current.rotation.x,
      targetPose.rotation[0],
      movementDamping,
      delta
    );
    groupRef.current.rotation.y = THREE.MathUtils.damp(
      groupRef.current.rotation.y,
      targetPose.rotation[1],
      movementDamping,
      delta
    );
    groupRef.current.rotation.z = THREE.MathUtils.damp(
      groupRef.current.rotation.z,
      targetPose.rotation[2],
      movementDamping,
      delta
    );

    const nextScale = THREE.MathUtils.damp(
      groupRef.current.scale.x,
      targetPose.scale,
      movementDamping,
      delta
    );
    groupRef.current.scale.setScalar(nextScale);

    activeCamera.position.x = THREE.MathUtils.damp(
      activeCamera.position.x,
      targetCamera.position[0],
      cameraDamping,
      delta
    );
    activeCamera.position.y = THREE.MathUtils.damp(
      activeCamera.position.y,
      targetCamera.position[1],
      cameraDamping,
      delta
    );
    activeCamera.position.z = THREE.MathUtils.damp(
      activeCamera.position.z,
      targetCamera.position[2],
      cameraDamping,
      delta
    );

    const nextFov = THREE.MathUtils.damp(
      activeCamera.fov,
      targetCamera.fov,
      cameraDamping,
      delta
    );

    if (Math.abs(activeCamera.fov - nextFov) > 0.001) {
      activeCamera.fov = nextFov;
      activeCamera.updateProjectionMatrix();
    }
  });

  return <group ref={groupRef}>{children}</group>;
}

function SceneContent({
  viewState,
  reducedMotion,
  simTextureType,
}: {
  viewState: ViewState;
  reducedMotion: boolean;
  simTextureType: "float" | "half-float";
}) {
  return (
    <>
      <ambientLight intensity={0.8} />
      <pointLight position={[5, 5, 7]} intensity={0.8} />
      <pointLight position={[-6, 4, 6]} intensity={0.6} color="#EEDDEE" />
      <pointLight position={[0, -5, 5]} intensity={0.4} color="#E8A0B1" />
      <pointLight position={[3, -2, 8]} intensity={0.3} color="#ECF1FA" />
      <directionalLight position={[-8, 5, 5]} intensity={0.7} color="#866AD6" />

      <SceneRig viewState={viewState} reducedMotion={reducedMotion}>
        <RimSparkleSphere
          position={[0, 0, 0]}
          renderOrder={20}
          colorA="#B37FD3"
          colorB="#E8A0B1"
          colorC="#9C66CA"
          hazeColor="#C3A0FF"
          hazeOpacity={0.44}
          hazeInnerStop={0.14}
          hazeSoftness={0.32}
          segments={SCENE_VISUAL_CONFIG.sphereSegments}
        />

        {PARTICLE_CONFIGS.map((config) => (
          <FBOParticles
            key={`${config.size}-${config.frequency}`}
            size={config.size}
            pointSize={config.pointSize}
            frequency={config.frequency}
            color1={config.colors[0]}
            color2={config.colors[1]}
            color3={config.colors[2]}
            color4={config.colors[3]}
            blending={config.blending}
            densityBias={config.densityBias}
            alphaBase={config.alphaBase}
            alphaBoost={config.alphaBoost}
            darkTintMix={config.darkTintMix}
            depthFade={config.depthFade}
            clumpFlatten={config.clumpFlatten ?? 0}
            fieldMode={config.fieldMode ?? 0}
            glowBoost={config.glowBoost ?? 0}
            outerGlowMirror={config.outerGlowMirror ?? 0}
            colorBoost={config.colorBoost ?? 0}
            simTextureType={simTextureType}
          />
        ))}

        <ExternalSparkles2D
          count={SCENE_VISUAL_CONFIG.outerSparkleCount}
          color1="#FBFAFC"
          color2="#F3C8C0"
          color3="#ECF1FA"
          circleRadius={1.4}
          mouseInfluenceRadius={0.15}
          mouseRepelStrength={0.1}
          returnSpeed={0.18}
        />
      </SceneRig>

      <EffectComposer multisampling={0}>
        <Bloom
          intensity={SCENE_VISUAL_CONFIG.bloom.intensity}
          luminanceThreshold={SCENE_VISUAL_CONFIG.bloom.luminanceThreshold}
          luminanceSmoothing={SCENE_VISUAL_CONFIG.bloom.luminanceSmoothing}
          radius={SCENE_VISUAL_CONFIG.bloom.radius}
        />
      </EffectComposer>
    </>
  );
}

export function Scene({
  viewState = "revealed",
  reducedMotion = false,
}: SceneProps) {
  const capabilities = useMemo(() => detectCapabilities(), []);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      logCapabilities();
    }
  }, []);

  return (
    <div className="h-full w-full">
      <Canvas
        camera={{ position: [0, 0, 15], fov: 35, near: 0.1, far: 50 }}
        dpr={SCENE_VISUAL_CONFIG.dpr}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          depth: true,
        }}
        style={{ width: "100%", height: "100%" }}
      >
        <Suspense fallback={null}>
          <SceneContent
            viewState={viewState}
            reducedMotion={reducedMotion}
            simTextureType={capabilities.preferredSimTextureType}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
