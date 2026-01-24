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

const PARTICLE_COUNT_DESKTOP = 25000;
const PARTICLE_COUNT_MOBILE = 7500;
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
  const isDev = process.env.NODE_ENV === "development";

  const DEFAULTS = {
    enabled: true,
    baseColor: "#a855f7",
    glowColor: "#e9d5ff",
  };

  const controls = isDev
    ? useControls({
      Sparkles: folder(
        {
          enabled: { value: DEFAULTS.enabled, label: "Enabled" },
          baseColor: { value: DEFAULTS.baseColor, label: "Base Color" },
          glowColor: { value: DEFAULTS.glowColor, label: "Glow Color" },
        },
        { collapsed: true }
      ),
    })
    : DEFAULTS;

  // ============================================
  // Per-particle attributes (MUST be created before GPU compute)
  // ============================================



  // ============================================
  // Per-particle attributes (MUST be created before GPU compute)
  // ============================================

  const layers = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const roll = Math.random();
      if (roll < 0.45) {
        arr[i] = 0.0; // Dust (45%)
      } else if (roll < 0.93) {
        arr[i] = 1.0; // Body (48%)
      } else {
        arr[i] = 2.0; // Glint (5%)
      }
    }
    return arr;
  }, [particleCount]);

  const sprites = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = layers[i]; // 0=dust, 1=bokeh, 2=glint
    }
    return arr;
  }, [particleCount, layers]);

  const rotations = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = Math.random() * Math.PI * 2;
    }
    return arr;
  }, [particleCount]);

  const aspects = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = 0.6 + Math.random() * 0.8;
    }
    return arr;
  }, [particleCount]);

  const twinkles = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = Math.random();
    }
    return arr;
  }, [particleCount]);

  const isWhite = useMemo(() => {
    const arr = new Float32Array(particleCount);
    // Legacy isWhite support (map from layers if needed, or keep for now)
    // The plan replaces this with "layers", but we keep it for backward compat in compute if needed.
    // However, the new system relies on layers.
    // For now, let's keep isWhite partially aligned with Glint layer for compute spawn logic compatibility
    // until we fully update compute to use layers.
    for (let i = 0; i < particleCount; i++) {
      // Glint layer (2.0) roughly maps to "white/bright"
      // But let's keep the original random logic to avoid breaking compute immediatey
      // Or better: map isWhite to Glint layer?
      // The compute uses isWhite to make particles "immortal".
      // Let's stick to the plan: Phase B changes rendering.
      // We can keep isWhite as is for now, or derive it.
      // To be safe, let's actally DERIVE isWhite from the Glint layer so they are consistent.
      arr[i] = layers[i] === 2.0 ? 1.0 : 0.0;
    }
    return arr;
  }, [particleCount, layers]);

  const phases = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = Math.random() * Math.PI * 2;
    }
    return arr;
  }, [particleCount]);

  // Seed for per-particle variation (speed, brightness, hue)
  const seeds = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = Math.random();  // 0-1 range
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
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));
    geo.setAttribute("aSprite", new THREE.BufferAttribute(sprites, 1));
    geo.setAttribute("aRot", new THREE.BufferAttribute(rotations, 1));
    geo.setAttribute("aAspect", new THREE.BufferAttribute(aspects, 1));
    geo.setAttribute("aTwinkle", new THREE.BufferAttribute(twinkles, 1));

    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);

    return geo;
  }, [particleCount, uvs, phases, isWhite, seeds, layers, sprites, rotations, aspects, twinkles]);

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
