import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFBO } from "@react-three/drei";
import { createPortal, useFrame } from "@react-three/fiber";

import SimulationMaterial from "@/components/experience/orbReference/SimulationMaterial";
import {
  fragmentShader,
  simulationFragmentShader,
  simulationVertexShader,
  vertexShader,
} from "@/components/experience/orbReference/shaders";

type FboParticlesProps = {
  size?: number;
  pointSize?: number;
  blending?: THREE.Blending;
  color1?: string;
  color2?: string;
  color3?: string;
  color4?: string;
  frequency?: number;
  simVertShader?: string;
  simFragShader?: string;
};

export function FBOParticles({
  size = 32,
  pointSize = 3.0,
  blending = THREE.NormalBlending,
  color1 = "#887DAD",
  color2 = "#C69BBB",
  color3 = "#EDE8F2",
  color4 = "#E0EEF1",
  frequency = 0.15,
  simVertShader = simulationVertexShader,
  simFragShader = simulationFragmentShader,
}: FboParticlesProps) {
  const points = useRef<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);

  const scene = useMemo(() => new THREE.Scene(), []);
  const camera = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 1 / Math.pow(2, 53), 1),
    []
  );

  const [simulationMaterial] = useState(
    () => new SimulationMaterial(size, simVertShader, simFragShader, frequency)
  );
  const simulationUniformsRef = useRef(simulationMaterial.uniforms);

  const renderTarget = useFBO(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    format: THREE.RGBAFormat,
    stencilBuffer: false,
    type: THREE.FloatType,
    depthBuffer: false,
  });

  const particlesPosition = useMemo(() => {
    const length = size * size;
    const particles = new Float32Array(length * 3);

    for (let i = 0; i < length; i++) {
      const i3 = i * 3;
      particles[i3 + 0] = (i % size) / size;
      particles[i3 + 1] = Math.floor(i / size) / size;
      particles[i3 + 2] = 0;
    }

    return particles;
  }, [size]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(particlesPosition, 3));
    return geo;
  }, [particlesPosition]);

  const uniforms = useMemo(
    () => ({
      uPositions: { value: null as THREE.Texture | null },
      uTime: { value: 0 },
      uPointSize: { value: pointSize },
      uColor1: { value: new THREE.Color(color1) },
      uColor2: { value: new THREE.Color(color2) },
      uColor3: { value: new THREE.Color(color3) },
      uColor4: { value: new THREE.Color(color4) },
    }),
    [pointSize, color1, color2, color3, color4]
  );

  useEffect(() => {
    simulationUniformsRef.current = simulationMaterial.uniforms;
    simulationUniformsRef.current.positions.value.needsUpdate = true;

    return () => {
      geometry.dispose();
      simulationMaterial.dispose();
      renderTarget.dispose();
    };
  }, [geometry, renderTarget, simulationMaterial]);

  useFrame((state) => {
    const { clock, gl } = state;

    if (!points.current) return;

    gl.setRenderTarget(renderTarget);
    gl.render(scene, camera);
    gl.setRenderTarget(null);

    points.current.material.uniforms.uPositions.value = renderTarget.texture;
    points.current.material.uniforms.uTime.value = clock.elapsedTime;

    simulationUniformsRef.current.uTime.value = clock.elapsedTime;
    points.current.material.needsUpdate = true;
  });

  return (
    <>
      {createPortal(
        <mesh>
          <planeGeometry args={[2, 2]} />
          <primitive object={simulationMaterial} attach="material" />
        </mesh>,
        scene
      )}

      <points ref={points} frustumCulled={false} visible>
        <primitive object={geometry} attach="geometry" />
        <shaderMaterial
          blending={blending}
          depthWrite={false}
          depthTest={false}
          fragmentShader={fragmentShader}
          vertexShader={vertexShader}
          uniforms={uniforms}
          transparent
        />
      </points>
    </>
  );
}
