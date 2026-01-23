"use client";

import { useRef, useMemo } from "react";
import * as THREE from "three";
import { useFrame, extend } from "@react-three/fiber";
import { shaderMaterial } from "@react-three/drei";
import { useControls } from "leva";
import vertexShader from "@/shaders/orb.vert";
import fragmentShader from "@/shaders/orb.frag";

// Helper to get CSS variable value
const getCssColor = (varName: string) => {
    if (typeof window === 'undefined') return new THREE.Color(0xffffff);
    const style = getComputedStyle(document.body);
    const colorStr = style.getPropertyValue(varName).trim();
    // If empty (e.g. during first render before body styles are computed?), fallback
    if (!colorStr) return new THREE.Color(0xe7e4f2);
    return new THREE.Color(colorStr);
}

const OrbMaterialImpl = shaderMaterial(
    {
        uTime: 0,
        uResolution: new THREE.Vector2(0, 0),
        // Colors will be passed as uniforms updated from CSS
        uBaseColor: new THREE.Color(0xE7E4F2),
        uCoolColor: new THREE.Color(0xD6F0FF),
        uWarmColor: new THREE.Color(0xF2C6D4),
    },
    vertexShader,
    fragmentShader
);

extend({ OrbMaterialImpl });

export function Orb() {
    const materialRef = useRef<THREE.ShaderMaterial>(null);

    useFrame((state) => {
        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();

            // Sync Uniforms with CSS variables (Cheap way to let CSS drive the shader colors)
            // In production we might use store, but this ensures A/B/C palette switching works instantly
            materialRef.current.uniforms.uBaseColor.value = getCssColor('--orb-base');
            materialRef.current.uniforms.uCoolColor.value = getCssColor('--orb-cool');
            materialRef.current.uniforms.uWarmColor.value = getCssColor('--orb-warm');
        }
    });

    return (
        <mesh>
            <sphereGeometry args={[1.0, 64, 64]} />
            {/* @ts-ignore */}
            <orbMaterialImpl ref={materialRef} transparent />
        </mesh>
    );
}
