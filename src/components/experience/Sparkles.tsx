"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { useControls, folder } from "leva";
import { useQualityStore } from "@/lib/stores/qualityStore";
import { useShapeStore } from "@/lib/stores/shapeStore";
import { ParticleCompute } from "@/lib/particleCompute";
import { FluidField } from "@/lib/fluidField";

import vertexShader from "@/shaders/sparkles.vert";
import fragmentShader from "@/shaders/sparkles.frag";

const PARTICLE_COUNT_DESKTOP = 32000;
const PARTICLE_COUNT_MOBILE = 10000;
const TEXTURE_SIZE_DESKTOP = 256;
const TEXTURE_SIZE_MOBILE = 128;

const raycaster = new THREE.Raycaster();
const tempHitPoint = new THREE.Vector3();
const tempLocalHit = new THREE.Vector3();

function rayToSphereLocal(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  radius: number,
  out: THREE.Vector3
): boolean {
  raycaster.setFromCamera(pointer, camera);
  const { origin, direction } = raycaster.ray;

  const a = direction.dot(direction);
  const b = 2 * origin.dot(direction);
  const c = origin.dot(origin) - radius * radius;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return false;

  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  if (t < 0) return false;

  tempHitPoint.copy(direction).multiplyScalar(t).add(origin);
  tempLocalHit.copy(tempHitPoint).divideScalar(radius);
  tempLocalHit.multiplyScalar(0.85);

  out.copy(tempLocalHit);
  return true;
}

function getResponsiveRadius(viewportWidth: number, baseRadius: number): number {
  const minWidth = 480;
  const maxWidth = 1200;
  const minRadius = 0.5;
  const maxRadius = baseRadius;

  const t = Math.max(0, Math.min(1, (viewportWidth - minWidth) / (maxWidth - minWidth)));
  const eased = 1 - (1 - t) * (1 - t);

  return minRadius + (maxRadius - minRadius) * eased;
}

function createUniforms(renderMode: number) {
  return {
    uTime: { value: 0 },
    uOrbRadius: { value: 1.0 },
    uMorphFade: { value: 1.0 },
    uRenderMode: { value: renderMode }, // 0=body+dust, 1=glint
    uPixelRatio: { value: 1.0 },
    uBaseColor: { value: new THREE.Color(0.66, 0.33, 0.97) },
    uGlowColor: { value: new THREE.Color(0.91, 0.84, 1.0) },
    texturePosition: { value: null as THREE.Texture | null },
  };
}

function hash01(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

type SparkleUniforms = {
  uTime: THREE.IUniform<number>;
  uOrbRadius: THREE.IUniform<number>;
  uMorphFade: THREE.IUniform<number>;
  uRenderMode: THREE.IUniform<number>;
  uPixelRatio: THREE.IUniform<number>;
  uBaseColor: THREE.IUniform<THREE.Color>;
  uGlowColor: THREE.IUniform<THREE.Color>;
  texturePosition: THREE.IUniform<THREE.Texture | null>;
};

export function Sparkles() {
  const { gl, size } = useThree();
  const tier = useQualityStore((s) => s.tier);
  const morphProgress = useShapeStore((s) => s.morphProgress);

  const DEFAULTS = {
    enabled: true,
    baseColor: "#8f5de6",
    glowColor: "#efe2ff",
    glintColor: "#ffffff",
  };

  const bodyMaterialRef = useRef<THREE.ShaderMaterial>(null);
  const glintMaterialRef = useRef<THREE.ShaderMaterial>(null);

  const particleComputeRef = useRef<ParticleCompute | null>(null);
  const fluidFieldRef = useRef<FluidField | null>(null);

  const prevPointer = useRef(new THREE.Vector2(0, 0));
  const pointerVelocity = useRef(new THREE.Vector2(0, 0));
  const pointerLocal = useRef(new THREE.Vector3(0, 0, -999));
  const baseColorRef = useRef(new THREE.Color(DEFAULTS.baseColor));
  const glowColorRef = useRef(new THREE.Color(DEFAULTS.glowColor));
  const glintColorRef = useRef(new THREE.Color(DEFAULTS.glintColor));
  const prevTime = useRef(0);

  const isMobile = tier.tierName === "mobile";
  const particleCount = isMobile ? PARTICLE_COUNT_MOBILE : PARTICLE_COUNT_DESKTOP;
  const textureSize = isMobile ? TEXTURE_SIZE_MOBILE : TEXTURE_SIZE_DESKTOP;

  const isDev = process.env.NODE_ENV === "development";

  const devControls = useControls({
    Sparkles: folder(
      {
        enabled: { value: DEFAULTS.enabled, label: "Enabled" },
        baseColor: { value: DEFAULTS.baseColor, label: "Base Color" },
        glowColor: { value: DEFAULTS.glowColor, label: "Glow Color" },
        glintColor: { value: DEFAULTS.glintColor, label: "Glint Tint" },
      },
      { collapsed: true }
    ),
  });

  const controls = isDev ? devControls : DEFAULTS;

  const layers = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      const roll = hash01(i, 0.31);
      if (roll < 0.36) {
        arr[i] = 0.0; // Dust
      } else if (roll < 0.92) {
        arr[i] = 1.0; // Body
      } else {
        arr[i] = 2.0; // Glint
      }
    }
    return arr;
  }, [particleCount]);

  const sprites = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = layers[i];
    return arr;
  }, [particleCount, layers]);

  const rotations = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = hash01(i, 1.77) * Math.PI * 2;
    return arr;
  }, [particleCount]);

  const aspects = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = 0.7 + hash01(i, 2.43) * 0.6;
    return arr;
  }, [particleCount]);

  const twinkles = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = hash01(i, 3.91);
    return arr;
  }, [particleCount]);

  const isWhite = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
      arr[i] = layers[i] > 1.5 ? 1.0 : 0.0;
    }
    return arr;
  }, [particleCount, layers]);

  const phases = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = hash01(i, 4.61) * Math.PI * 2;
    return arr;
  }, [particleCount]);

  const seeds = useMemo(() => {
    const arr = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) arr[i] = hash01(i, 5.13);
    return arr;
  }, [particleCount]);

  useEffect(() => {
    particleComputeRef.current = new ParticleCompute(gl, particleCount, isMobile, isWhite, layers);

    return () => {
      particleComputeRef.current?.dispose();
      particleComputeRef.current = null;
    };
  }, [gl, particleCount, isMobile, isWhite, layers]);

  useEffect(() => {
    const sizePx = isMobile ? 96 : 160;
    fluidFieldRef.current = new FluidField(gl, {
      size: sizePx,
      pressureIterations: isMobile ? 6 : 10,
    });

    return () => {
      fluidFieldRef.current?.dispose();
      fluidFieldRef.current = null;
    };
  }, [gl, isMobile]);

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

    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2.4);
    return geo;
  }, [particleCount, uvs, phases, isWhite, seeds, layers, sprites, rotations, aspects, twinkles]);

  const bodyUniforms = useMemo(() => createUniforms(0), []);
  const glintUniforms = useMemo(() => createUniforms(1), []);

  const bodyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: bodyUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.NormalBlending,
      }),
    [bodyUniforms]
  );

  const glintMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: glintUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
      }),
    [glintUniforms]
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      bodyMaterial.dispose();
      glintMaterial.dispose();
    };
  }, [geometry, bodyMaterial, glintMaterial]);

  useFrame((state) => {
    if (!particleComputeRef.current || !bodyMaterialRef.current || !glintMaterialRef.current) return;

    const time = state.clock.elapsedTime;
    const deltaTime = time - prevTime.current;
    prevTime.current = time;

    const responsiveRadius = getResponsiveRadius(size.width, 1.0);

    const { pointer } = state;
    pointerVelocity.current.set(pointer.x - prevPointer.current.x, pointer.y - prevPointer.current.y);
    prevPointer.current.set(pointer.x, pointer.y);

    const speed = pointerVelocity.current.length();
    const pointerEnergy = Math.min(1.0, speed * 18.0);

    if (rayToSphereLocal(state.camera, pointer, responsiveRadius, pointerLocal.current)) {
      // no-op, pointerLocal is filled in-place
    } else {
      pointerLocal.current.set(0, 0, -999);
    }

    fluidFieldRef.current?.update(
      time,
      deltaTime,
      pointer,
      pointerEnergy,
      size.width / Math.max(size.height, 1)
    );

    const flowTexture = fluidFieldRef.current?.getVelocityTexture() ?? null;

    particleComputeRef.current.update(
      time,
      deltaTime,
      responsiveRadius,
      pointerLocal.current.z > -900 ? pointerLocal.current : null,
      pointerEnergy,
      flowTexture
    );

    const positionTexture = particleComputeRef.current.getPositionTexture();

    const dpr = gl.getPixelRatio();

    baseColorRef.current.set(controls.baseColor);
    glowColorRef.current.set(controls.glowColor);
    glintColorRef.current.set(controls.glintColor);

    const updateShared = (u: SparkleUniforms) => {
      u.uTime.value = time;
      u.uOrbRadius.value = responsiveRadius;
      u.uMorphFade.value = 1.0 - morphProgress;
      u.uPixelRatio.value = dpr;
      u.uBaseColor.value.copy(baseColorRef.current);
      u.uGlowColor.value.copy(glowColorRef.current);
      u.texturePosition.value = positionTexture;
    };

    updateShared(bodyMaterialRef.current.uniforms as unknown as SparkleUniforms);
    updateShared(glintMaterialRef.current.uniforms as unknown as SparkleUniforms);

    // Push a brighter tint into glints while keeping palette family.
    (glintMaterialRef.current.uniforms.uGlowColor.value as THREE.Color).lerp(glintColorRef.current, 0.6);
  });

  if (!controls.enabled) return null;

  return (
    <group>
      <points frustumCulled={false} renderOrder={1}>
        <primitive object={geometry} attach="geometry" />
        <primitive object={bodyMaterial} attach="material" ref={bodyMaterialRef} />
      </points>

      <points frustumCulled={false} renderOrder={2}>
        <primitive object={geometry} attach="geometry" />
        <primitive object={glintMaterial} attach="material" ref={glintMaterialRef} />
      </points>
    </group>
  );
}
