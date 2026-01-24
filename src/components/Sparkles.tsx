"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import { useQualityStore } from "@/lib/qualityStore";
import { useShapeStore } from "@/lib/shapeStore";
import { ParticleCompute } from "@/lib/particleCompute";

import vertexShader from "@/shaders/sparkles.vert";
import fragmentShader from "@/shaders/sparkles.frag";

// ============================================
// Constants
// ============================================

const PARTICLE_COUNT_DESKTOP = 15000;
const PARTICLE_COUNT_MOBILE = 5000;
const TEXTURE_SIZE_DESKTOP = 256;
const TEXTURE_SIZE_MOBILE = 128;

// ============================================
// Module-scope objects (avoid GC jitter)
// ============================================

const raycaster = new THREE.Raycaster();
const tempHitPoint = new THREE.Vector3();
const tempLocalHit = new THREE.Vector3();

// ============================================
// Ray-Sphere Intersection (returns LOCAL coords)
// ============================================

function rayToSphereLocal(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  radius: number
): THREE.Vector3 | null {
  raycaster.setFromCamera(pointer, camera);
  const { origin, direction } = raycaster.ray;

  const a = direction.dot(direction);
  const b = 2 * origin.dot(direction);
  const c = origin.dot(origin) - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0) return null;

  tempHitPoint.copy(direction).multiplyScalar(t).add(origin);
  tempLocalHit.copy(tempHitPoint).divideScalar(radius);
  tempLocalHit.multiplyScalar(0.85);

  return tempLocalHit.clone();
}

// ============================================
// Responsive Radius (matches Orb.tsx)
// ============================================

function getResponsiveRadius(viewportWidth: number, baseRadius: number): number {
  const minWidth = 480;
  const maxWidth = 1200;
  const minRadius = 0.5;
  const maxRadius = baseRadius;

  const t = Math.max(0, Math.min(1, (viewportWidth - minWidth) / (maxWidth - minWidth)));
  const eased = 1 - (1 - t) * (1 - t);

  return minRadius + (maxRadius - minRadius) * eased;
}

// ============================================
// Sparkles Component
// ============================================

export function Sparkles() {
  const { gl, size } = useThree();
  const tier = useQualityStore((s) => s.tier);
  const morphProgress = useShapeStore((s) => s.morphProgress);

  // Refs
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const particleComputeRef = useRef<ParticleCompute | null>(null);
  const prevPointer = useRef({ x: 0, y: 0 });
  const prevTime = useRef(0);

  // Determine if mobile
  const isMobile = tier.tierName === "mobile";
  const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;
  const textureSize = isMobile ? TEXTURE_SIZE_MOBILE : TEXTURE_SIZE_DESKTOP;

  // Leva controls
  const controls = useControls({
    Sparkles: folder(
      {
        enabled: { value: true, label: "Enabled" },
        baseColor: { value: "#a855f7", label: "Base Color" },
        glowColor: { value: "#e9d5ff", label: "Glow Color" },
      },
      { collapsed: true }
    ),
  });

  // ============================================
  // Per-particle attributes (MUST be created before GPU compute)
  // ============================================

  const isWhite = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      // ~5% white accents
      arr[i] = Math.random() < 0.05 ? 1.0 : 0.0;
    }
    return arr;
  }, [particleCount]);

  const phases = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = Math.random() * Math.PI * 2;
    }
    return arr;
  }, [particleCount]);

  // ============================================
  // Initialize GPU Compute (needs isWhite array)
  // ============================================

  useEffect(() => {
    // Pass isWhite to GPU compute so white particles don't respawn from center
    particleComputeRef.current = new ParticleCompute(gl, particleCount, isMobile, isWhite);
    
    return () => {
      particleComputeRef.current?.dispose();
      particleComputeRef.current = null;
    };
  }, [gl, particleCount, isMobile, isWhite]);

  // ============================================
  // Create UV coordinates for texture sampling
  // ============================================

  const uvs = useMemo(() => {
    const arr = new Float32Array(particleCount * 2);
    
    for (let i = 0; i < particleCount; i++) {
      const u = ((i % textureSize) + 0.5) / textureSize;
      const v = (Math.floor(i / textureSize) + 0.5) / textureSize;
      arr[i * 2] = u;
      arr[i * 2 + 1] = v;
    }
    
    return arr;
  }, [particleCount, textureSize]);

  // ============================================
  // Geometry
  // ============================================

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();

    const dummyPositions = new Float32Array(particleCount * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(dummyPositions, 3));
    geo.setAttribute("aUv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aIsWhite", new THREE.BufferAttribute(isWhite, 1));

    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);

    return geo;
  }, [particleCount, uvs, phases, isWhite]);

  // ============================================
  // Uniforms
  // ============================================

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOrbRadius: { value: 1.0 },
      uMorphFade: { value: 1.0 },
      uBaseColor: { value: new THREE.Color(0.66, 0.33, 0.97) },
      uGlowColor: { value: new THREE.Color(0.91, 0.84, 1.0) },
      texturePosition: { value: null as THREE.Texture | null },
    }),
    []
  );

  // ============================================
  // Shader Material
  // ============================================

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms]
  );

  // ============================================
  // Per-Frame Updates
  // ============================================

  useFrame((state) => {
    if (!materialRef.current || !particleComputeRef.current) return;

    const u = materialRef.current.uniforms;
    const time = state.clock.elapsedTime;
    const deltaTime = time - prevTime.current;
    prevTime.current = time;

    const responsiveRadius = getResponsiveRadius(size.width, 1.0);

    const { pointer } = state;
    const vx = pointer.x - prevPointer.current.x;
    const vy = pointer.y - prevPointer.current.y;
    const energy = Math.min(1, Math.sqrt(vx * vx + vy * vy) * 20);
    prevPointer.current = { x: pointer.x, y: pointer.y };

    const localHit = rayToSphereLocal(state.camera, pointer, responsiveRadius);

    particleComputeRef.current.update(
      time,
      deltaTime,
      responsiveRadius,
      localHit,
      energy
    );

    const positionTexture = particleComputeRef.current.getPositionTexture();

    u.uTime.value = time;
    u.uOrbRadius.value = responsiveRadius;
    u.uMorphFade.value = 1.0 - morphProgress;
    u.uBaseColor.value.set(controls.baseColor);
    u.uGlowColor.value.set(controls.glowColor);
    u.texturePosition.value = positionTexture;
  });

  if (!controls.enabled) return null;

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" ref={materialRef} />
    </points>
  );
}
