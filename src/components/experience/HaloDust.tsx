"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, useThree, useLoader } from "@react-three/fiber";
import { useQualityStore } from "@/lib/stores/qualityStore";

import vertexShader from "@/shaders/sparkles.vert";
import fragmentShader from "@/shaders/sparkles.frag";

export function HaloDust() {
    const materialRef = useRef<THREE.ShaderMaterial>(null);
    const { size } = useThree();
    const tier = useQualityStore((s) => s.tier);

    const isMobile = tier.tierName === "mobile";
    const particleCount = isMobile ? 800 : 2000;

    // Load texture for soft halo look
    const spriteDust = useLoader(THREE.TextureLoader, "/textures/sprite_dust.png");

    const getResponsiveRadius = (viewportWidth: number): number => {
        const minWidth = 480;
        const maxWidth = 1200;
        const t = Math.max(0, Math.min(1, (viewportWidth - minWidth) / (maxWidth - minWidth)));
        return 0.5 + (1.0 - 0.5) * (1 - (1 - t) * (1 - t));
    };

    const { geometry, uniforms } = useMemo(() => {
        const geo = new THREE.BufferGeometry();

        const positions = new Float32Array(particleCount * 3);
        const phases = new Float32Array(particleCount);
        const seeds = new Float32Array(particleCount);

        // Dummy attributes required by the shared shader
        const layers = new Float32Array(particleCount);
        const sprites = new Float32Array(particleCount);
        const rotations = new Float32Array(particleCount);
        const aspects = new Float32Array(particleCount);
        const twinkles = new Float32Array(particleCount);
        const isWhite = new Float32Array(particleCount);
        const uvs = new Float32Array(particleCount * 2);

        for (let i = 0; i < particleCount; i++) {
            // Thin shell: r = 0.98..1.12
            const r = 0.98 + Math.random() * 0.14;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.cos(phi);
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            phases[i] = Math.random();
            seeds[i] = Math.random();

            // Force "Dust" layer behavior
            layers[i] = 0.0;
            sprites[i] = 0.0;
            rotations[i] = Math.random() * Math.PI * 2;
            aspects[i] = 1.0;
            twinkles[i] = Math.random();
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
        geo.setAttribute('aLayer', new THREE.BufferAttribute(layers, 1));
        geo.setAttribute('aSprite', new THREE.BufferAttribute(sprites, 1));
        geo.setAttribute('aRot', new THREE.BufferAttribute(rotations, 1));
        geo.setAttribute('aAspect', new THREE.BufferAttribute(aspects, 1));
        geo.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));
        geo.setAttribute('aIsWhite', new THREE.BufferAttribute(isWhite, 1));
        geo.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2)); // Not used for halo but required by shader

        return {
            geometry: geo,
            uniforms: {
                uTime: { value: 0 },
                uOrbRadius: { value: 1.0 },
                uBaseColor: { value: new THREE.Color(0.66, 0.33, 0.97) },
                uGlowColor: { value: new THREE.Color(0.91, 0.84, 1.0) },
                uMorphFade: { value: 0.0 },
                // Reuse main shader uniforms, but provide dummy texture for "texturePosition" 
                // since we are using explicit positions here.
                // Wait, the main shader reads from texturePosition.
                // We cannot reuse the main shader AS IS unless we trick it or make a variant.
                // The main shader DOES NOT use aPosition attribute, it READS from texture.
                // So we MUST create a simpler shader for HaloDust or modify the main one.
                // Let's create a simpler inline shader for HaloDust to avoid complex dependency.
            }
        };
    }, [particleCount]);

    // Define simplified shaders inline to avoid dependency issues with main particle system
    const simpleVert = `
    uniform float uTime;
    uniform float uOrbRadius;
    attribute float aPhase;
    attribute float aSeed;
    varying float vAlpha;
    varying float vPhase;
    
    void main() {
      vec3 pos = position; // Explicit position
      
      // Slow rotation
      float theta = uTime * 0.02;
      float c = cos(theta);
      float s = sin(theta);
      pos.xz = mat2(c, -s, s, c) * pos.xz;
      
      // Slight breathe
      pos *= (1.0 + 0.02 * sin(uTime * 0.5 + aSeed * 10.0));
      
      vec4 mvPosition = modelViewMatrix * vec4(pos * uOrbRadius, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      
      // Size calculation
      float dist = length(mvPosition.xyz);
      gl_PointSize = (40.0 / dist) * (0.5 + 0.5 * aSeed); 
      
      vPhase = aPhase;
      vAlpha = 0.3 + 0.2 * sin(uTime * 1.0 + aPhase * 10.0);
    }
  `;

    const simpleFrag = `
    uniform sampler2D uSpriteDust;
    varying float vAlpha;
    varying float vPhase;
    
    void main() {
      vec2 uv = gl_PointCoord;
      vec4 tex = texture2D(uSpriteDust, uv);
      if (tex.r < 0.1) discard;
      
      gl_FragColor = vec4(0.8, 0.7, 1.0, vAlpha * tex.r * 0.4);
    }
  `;

    const material = useMemo(() => new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uOrbRadius: { value: 1.0 },
            uSpriteDust: { value: spriteDust }
        },
        vertexShader: simpleVert,
        fragmentShader: simpleFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    }), [spriteDust]);

    useFrame((state) => {
        if (material) {
            material.uniforms.uTime.value = state.clock.elapsedTime;
            material.uniforms.uOrbRadius.value = getResponsiveRadius(size.width);
        }
    });

    return (
        <points geometry={geometry} material={material} />
    );
}
