import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

import { useMouse } from "@/components/experience/orbReference/useMouse";

type ExternalSparkles2DProps = {
  count?: number;
  color1?: string;
  color2?: string;
  color3?: string;
  circleRadius?: number;
  mouseInfluenceRadius?: number;
  mouseRepelStrength?: number;
  returnSpeed?: number;
};

const hash01 = (index: number, salt: number): number => {
  const x = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

export function ExternalSparkles2D({
  count = 3000,
  color1 = "#FBF4FF",
  color2 = "#FFFFFF",
  color3 = "#EAFBFF",
  circleRadius = 1.2,
  mouseInfluenceRadius = 2.0,
  mouseRepelStrength = 0.6,
  returnSpeed = 0.03,
}: ExternalSparkles2DProps) {
  const points = useRef<THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>>(null);
  const mouse = useMouse();

  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const mouseWorldPos = useMemo(() => new THREE.Vector3(), []);

  const particleData = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const phases = new Float32Array(count);
    const sizes = new Float32Array(count);
    const angles = new Float32Array(count);
    const distances = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = hash01(i, 0.13) * Math.PI * 2;
      angles[i] = angle;

      const initialDist = circleRadius + 0.05 + hash01(i, 0.29) * 0.1;
      distances[i] = initialDist;

      const x = Math.cos(angle) * initialDist;
      const y = Math.sin(angle) * initialDist;
      const z = 0;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      speeds[i] = 0.2 + hash01(i, 0.47) * 0.4;
      phases[i] = hash01(i, 0.61) * Math.PI * 2;
      sizes[i] = 0.03 + hash01(i, 0.83) * 0.15;
    }

    return { positions, speeds, phases, sizes, angles, distances };
  }, [count, circleRadius]);

  const colors = useMemo(() => {
    const cols = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const rand = hash01(i, 1.17);
      let c = new THREE.Color(color3);

      if (rand < 0.33) {
        c = new THREE.Color(color1);
      } else if (rand < 0.66) {
        c = new THREE.Color(color2);
      }

      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }

    return cols;
  }, [count, color1, color2, color3]);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(particleData.positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geom.setAttribute("speed", new THREE.BufferAttribute(particleData.speeds, 1));
    geom.setAttribute("phase", new THREE.BufferAttribute(particleData.phases, 1));
    geom.setAttribute("pSize", new THREE.BufferAttribute(particleData.sizes, 1));
    geom.setAttribute("angle", new THREE.BufferAttribute(particleData.angles, 1));
    geom.setAttribute("initialDist", new THREE.BufferAttribute(particleData.distances, 1));
    return geom;
  }, [particleData, colors]);

  const vertexShader = `
    uniform float uTime;
    uniform float uCircleRadius;
    uniform vec2 uMouse;
    uniform float uMouseInfluenceRadius;
    uniform float uMouseRepelStrength;
    uniform float uReturnSpeed;

    attribute float speed;
    attribute float phase;
    attribute float pSize;
    attribute float angle;
    attribute float initialDist;
    attribute vec3 color;

    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      float t = uTime * 1.2 + phase;
      float pulse = (sin(t) * 0.4 + 0.6) * speed;

      float maxDist = uCircleRadius + 0.8;
      float minDist = uCircleRadius + 0.1;
      float currentDist = minDist + (maxDist - minDist) * pulse;

      float baseX = cos(angle) * currentDist;
      float baseY = sin(angle) * currentDist;
      vec2 basePos = vec2(baseX, baseY);

      vec2 mouseVec = basePos - uMouse;
      float mouseDist = length(mouseVec);

      vec2 finalPos = basePos;
      if (mouseDist < uMouseInfluenceRadius) {
        float influence = (1.0 - mouseDist / uMouseInfluenceRadius) * uMouseRepelStrength;
        vec2 repelDir = normalize(mouseVec);
        finalPos += repelDir * influence * 0.5;
        finalPos = mix(finalPos, basePos, uReturnSpeed);
      }

      vec3 newPosition = vec3(finalPos.x, finalPos.y, 0.0);
      vColor = color;
      vAlpha = 0.8 + pulse * 0.2;

      vec4 mvPosition = modelViewMatrix * vec4(newPosition, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      float size = pSize * 2.0;
      gl_PointSize = size * (150.0 / (1.0 + length(mvPosition.xyz)));
    }
  `;

  const fragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;

    void main() {
      vec2 p = gl_PointCoord - vec2(0.5);
      float r = length(p);

      float edge = 0.45;
      float aa = fwidth(r);
      float alpha = 1.0 - smoothstep(edge - aa, edge + aa, r);

      if (alpha <= 0.0) discard;

      float sparkle = sin(gl_PointCoord.x * 12.0) * sin(gl_PointCoord.y * 12.0) * 0.08;
      vec3 finalColor = vColor + sparkle;

      gl_FragColor = vec4(finalColor, alpha * vAlpha * 0.95);
    }
  `;

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uCircleRadius: { value: circleRadius },
      uMouse: { value: new THREE.Vector2(100, 100) },
      uMouseInfluenceRadius: { value: mouseInfluenceRadius },
      uMouseRepelStrength: { value: mouseRepelStrength },
      uReturnSpeed: { value: returnSpeed },
    }),
    [circleRadius, mouseInfluenceRadius, mouseRepelStrength, returnSpeed]
  );

  useFrame((state) => {
    if (!points.current) return;

    points.current.material.uniforms.uTime.value = state.clock.elapsedTime;

    raycaster.setFromCamera(new THREE.Vector2(mouse.x, mouse.y), state.camera);

    if (raycaster.ray.intersectPlane(plane, mouseWorldPos)) {
      if (points.current.parent) {
        points.current.parent.worldToLocal(mouseWorldPos);
      }

      points.current.material.uniforms.uMouse.value.set(mouseWorldPos.x, mouseWorldPos.y);
    }
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
