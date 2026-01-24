"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import { useQualityStore } from "@/lib/qualityStore";
import { useShapeStore } from "@/lib/shapeStore";

import vertexShader from "@/shaders/sparkles.vert";
import fragmentShader from "@/shaders/sparkles.frag";

// ============================================
// Constants
// ============================================

const PARTICLE_COUNT_DESKTOP = 8000;
const PARTICLE_COUNT_MOBILE = 2500;

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
  // Set up ray from camera through pointer
  raycaster.setFromCamera(pointer, camera);
  const { origin, direction } = raycaster.ray;

  // Sphere at world origin with given radius
  // Quadratic: |origin + t * direction|² = radius²
  // a*t² + b*t + c = 0
  const a = direction.dot(direction); // Always 1 for normalized direction
  const b = 2 * origin.dot(direction);
  const c = origin.dot(origin) - radius * radius;

  const discriminant = b * b - 4 * a * c;

  // No intersection
  if (discriminant < 0) return null;

  // Take nearest positive t (front of sphere)
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);

  // Intersection behind camera
  if (t < 0) return null;

  // Compute world hit point
  tempHitPoint.copy(direction).multiplyScalar(t).add(origin);

  // Convert to local unit-sphere coordinates (divide by radius)
  tempLocalHit.copy(tempHitPoint).divideScalar(radius);

  // Nudge inward so vortex is well inside orb
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
  const { size } = useThree();
  const tier = useQualityStore((s) => s.tier);
  const morphProgress = useShapeStore((s) => s.morphProgress);

  // Refs
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const prevPointer = useRef({ x: 0, y: 0 });

  // Leva controls
  const controls = useControls({
    Sparkles: folder(
      {
        enabled: { value: true, label: "Enabled" },
        baseColor: { value: "#a855f7", label: "Base Color" },
        glowColor: { value: "#e9d5ff", label: "Glow Color" },  // White with purple hint
      },
      { collapsed: true }
    ),
  });

  // Particle count based on quality tier
  const particleCount = tier.tierName === "mobile" 
    ? PARTICLE_COUNT_MOBILE 
    : PARTICLE_COUNT_DESKTOP;

  // ============================================
  // Static Buffers (created once, never updated)
  // ============================================

  const positions = useMemo(() => {
    const arr = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      // Random point inside unit sphere (uniform distribution)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = Math.cbrt(Math.random()) * 0.85; // Cube root for uniform volume

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.cos(phi);
      const z = r * Math.sin(phi) * Math.sin(theta);

      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
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

  const isWhite = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      // ~7% white accents
      arr[i] = Math.random() < 0.07 ? 1.0 : 0.0;
    }
    return arr;
  }, [particleCount]);

  // ============================================
  // Geometry with standard 'position' attribute
  // ============================================

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();

    // Standard 'position' attribute (Three.js needs this for bounds)
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geo.setAttribute("aIsWhite", new THREE.BufferAttribute(isWhite, 1));

    // Compute bounding sphere for frustum culling
    geo.computeBoundingSphere();

    return geo;
  }, [positions, phases, isWhite]);

  // ============================================
  // Uniforms (NO uCamDist - computed in shader)
  // ============================================

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uOrbRadius: { value: 1.0 },
      uPointerLocal: { value: new THREE.Vector3(0, 0, -999) }, // Sentinel = inactive
      uPointerEnergy: { value: 0 },
      uMorphFade: { value: 1.0 },
      uBaseColor: { value: new THREE.Color(0.66, 0.33, 0.97) }, // Purple
      uGlowColor: { value: new THREE.Color(0.91, 0.84, 1.0) },  // White with purple hint
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
    if (!materialRef.current) return;

    const u = materialRef.current.uniforms;

    // Time
    u.uTime.value = state.clock.elapsedTime;

    // Responsive radius (matches orb)
    const responsiveRadius = getResponsiveRadius(size.width, 1.0);
    u.uOrbRadius.value = responsiveRadius;

    // Morph fade (sparkles disappear during shape morph)
    u.uMorphFade.value = 1.0 - morphProgress;

    // Pointer velocity for energy
    const { pointer } = state;
    const vx = pointer.x - prevPointer.current.x;
    const vy = pointer.y - prevPointer.current.y;
    const energy = Math.min(1, Math.sqrt(vx * vx + vy * vy) * 20);
    prevPointer.current = { x: pointer.x, y: pointer.y };

    // Ray-sphere intersection for pointer hit (in local coords)
    const localHit = rayToSphereLocal(state.camera, pointer, responsiveRadius);

    if (localHit) {
      u.uPointerLocal.value.copy(localHit);
    } else {
      u.uPointerLocal.value.set(0, 0, -999); // Sentinel
    }
    u.uPointerEnergy.value = energy;

    // Colors from Leva
    u.uBaseColor.value.set(controls.baseColor);
    u.uGlowColor.value.set(controls.glowColor);
  });

  // Don't render if disabled
  if (!controls.enabled) return null;

  // ============================================
  // Render
  // ============================================

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" ref={materialRef} />
    </points>
  );
}

