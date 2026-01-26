/**
 * GPU Particle Compute System
 * Uses GPUComputationRenderer for physics simulation on GPU
 */

import * as THREE from "three";
import { GPUComputationRenderer } from "three/examples/jsm/misc/GPUComputationRenderer.js";

import positionShader from "@/shaders/particleSimPosition.frag";
import velocityShader from "@/shaders/particleSimVelocity.frag";

// ============================================
// Types
// ============================================

interface ParticleComputeUniforms {
  uTime: THREE.IUniform<number>;
  uDeltaTime: THREE.IUniform<number>;
  uOrbRadius: THREE.IUniform<number>;
  uPointerLocal: THREE.IUniform<THREE.Vector3>;
  uPointerEnergy: THREE.IUniform<number>;
  uSpawnRadius: THREE.IUniform<number>;
  uLifeDecay: THREE.IUniform<number>;
  uDensityNoiseScale: THREE.IUniform<number>;
  uDensityContrast: THREE.IUniform<number>;
  uDensityOffset: THREE.IUniform<THREE.Vector3>;
  uFlowScale: THREE.IUniform<number>;
  uGlobalRotationSpeed: THREE.IUniform<number>;
  uVortexStrength: THREE.IUniform<number>;
  uVortex0: THREE.IUniform<THREE.Vector3>;
  uVortex1: THREE.IUniform<THREE.Vector3>;
  uFollowStrength: THREE.IUniform<number>;
  uDrag: THREE.IUniform<number>;
  uBoundaryPull: THREE.IUniform<number>;
  uMaxSpeed: THREE.IUniform<number>;
}

// ============================================
// Particle Compute Class
// ============================================

export class ParticleCompute {
  private gpuCompute: GPUComputationRenderer;
  private positionVariable: ReturnType<GPUComputationRenderer["addVariable"]>;
  private velocityVariable: ReturnType<GPUComputationRenderer["addVariable"]>;
  private textureWidth: number;
  private textureHeight: number;

  constructor(
    renderer: THREE.WebGLRenderer,
    particleCount: number,
    isMobile: boolean = false,
    isWhiteArray?: Float32Array
  ) {
    // Texture dimensions (square for simplicity)
    // 256x256 = 65,536 max particles
    // 128x128 = 16,384 for mobile
    this.textureWidth = isMobile ? 128 : 256;
    this.textureHeight = isMobile ? 128 : 256;

    // Initialize GPU compute renderer
    this.gpuCompute = new GPUComputationRenderer(
      this.textureWidth,
      this.textureHeight,
      renderer
    );

    // Use float textures for precision
    this.gpuCompute.setDataType(THREE.FloatType);

    // Create data textures
    const positionTexture = this.gpuCompute.createTexture();
    const velocityTexture = this.gpuCompute.createTexture();

    // Initialize texture data
    // Particles start distributed throughout the sphere, not just center
    this.initPositionTexture(positionTexture, particleCount, isWhiteArray);
    this.initVelocityTexture(velocityTexture, particleCount, isWhiteArray);

    // Add compute variables
    this.positionVariable = this.gpuCompute.addVariable(
      "texturePosition",
      positionShader,
      positionTexture
    );
    this.velocityVariable = this.gpuCompute.addVariable(
      "textureVelocity",
      velocityShader,
      velocityTexture
    );

    // Set dependencies (both depend on both)
    this.gpuCompute.setVariableDependencies(this.positionVariable, [
      this.positionVariable,
      this.velocityVariable,
    ]);
    this.gpuCompute.setVariableDependencies(this.velocityVariable, [
      this.positionVariable,
      this.velocityVariable,
    ]);

    // Add uniforms to position variable
    const posUniforms = this.positionVariable.material
      .uniforms as unknown as ParticleComputeUniforms;
    posUniforms.uTime = { value: 0.0 };
    posUniforms.uDeltaTime = { value: 0.016 };
    posUniforms.uOrbRadius = { value: 1.0 };
    posUniforms.uPointerLocal = { value: new THREE.Vector3(0, 0, -999) };
    posUniforms.uPointerEnergy = { value: 0.0 };
    posUniforms.uSpawnRadius = { value: 0.08 };  // Small center spawn
    posUniforms.uLifeDecay = { value: 0.1 };  // Moderate lifecycle
    posUniforms.uDensityNoiseScale = { value: 0.6 };
    posUniforms.uDensityContrast = { value: 1.8 };
    posUniforms.uDensityOffset = { value: new THREE.Vector3(0, 0, 0) };

    // Add uniforms to velocity variable
    const velUniforms = this.velocityVariable.material
      .uniforms as unknown as ParticleComputeUniforms;
    velUniforms.uTime = { value: 0.0 };
    velUniforms.uDeltaTime = { value: 0.016 };
    velUniforms.uOrbRadius = { value: 1.0 };
    velUniforms.uPointerLocal = { value: new THREE.Vector3(0, 0, -999) };
    velUniforms.uPointerEnergy = { value: 0.0 };
    velUniforms.uSpawnRadius = { value: 0.08 };  // Small center spawn
    velUniforms.uLifeDecay = { value: 0.1 };  // Moderate lifecycle
    velUniforms.uFlowScale = { value: 0.8 };
    velUniforms.uGlobalRotationSpeed = { value: 0.1 };
    velUniforms.uVortexStrength = { value: 0.4 };
    velUniforms.uVortex0 = { value: new THREE.Vector3(0, 0, 0) };
    velUniforms.uVortex1 = { value: new THREE.Vector3(0, 0, 0) };
    velUniforms.uFollowStrength = { value: 0.5 };
    velUniforms.uDrag = { value: 0.04 };
    velUniforms.uBoundaryPull = { value: 0.8 };
    velUniforms.uMaxSpeed = { value: 2.0 };

    // Initialize GPU compute
    const error = this.gpuCompute.init();
    if (error !== null) {
      console.error("GPUComputationRenderer init error:", error);
    }
  }

  /**
   * Initialize position texture with particles distributed throughout sphere
   * White particles get "immortal" life (100.0) so they never respawn from center
   */
  private initPositionTexture(
    texture: THREE.DataTexture,
    particleCount: number,
    isWhiteArray?: Float32Array
  ): void {
    const data = texture.image.data as Float32Array;
    const fillRadius = 0.85; // Distribute throughout this radius

    for (let i = 0; i < this.textureWidth * this.textureHeight; i++) {
      const idx = i * 4;

      if (i < particleCount) {
        // Random point inside sphere (uniform distribution)
        let x, y, z;
        do {
          x = Math.random() * 2 - 1;
          y = Math.random() * 2 - 1;
          z = Math.random() * 2 - 1;
        } while (x * x + y * y + z * z > 1);

        // Scale to fill radius - particles start distributed throughout sphere
        // MODIFIED: Start on SHELL (0.8 - 0.95) to match the simulation target
        // This prevents the "implosion" or "mud" look on startup

        // Random radius in shell band
        const rShell = 0.8 + Math.random() * 0.15;

        // Normalize direction
        const d = Math.sqrt(x * x + y * y + z * z);
        const nx = x / d;
        const ny = y / d;
        const nz = z / d;

        data[idx + 0] = nx * rShell;
        data[idx + 1] = ny * rShell;
        data[idx + 2] = nz * rShell;

        // Life value:
        // - White particles: 100.0 (immortal, never respawn)
        // - Purple particles: random 0-1 (will cycle through lifecycle)
        const isWhite = isWhiteArray ? isWhiteArray[i] > 0.5 : false;
        data[idx + 3] = isWhite ? 100.0 : Math.random();
      } else {
        // Unused pixels
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }

  /**
   * Initialize velocity texture with small random velocities
   */
  private initVelocityTexture(
    texture: THREE.DataTexture,
    particleCount: number,
    isWhiteArray?: Float32Array
  ): void {
    const data = texture.image.data as Float32Array;

    for (let i = 0; i < this.textureWidth * this.textureHeight; i++) {
      const idx = i * 4;

      if (i < particleCount) {
        // Small random initial velocity
        const speed = 0.02;
        data[idx + 0] = (Math.random() - 0.5) * speed;
        data[idx + 1] = (Math.random() - 0.5) * speed;
        data[idx + 2] = (Math.random() - 0.5) * speed;
        // Seed for noise variation (encode isWhite in high bit)
        const isWhite = isWhiteArray ? isWhiteArray[i] > 0.5 : false;
        data[idx + 3] = Math.random() + (isWhite ? 10.0 : 0.0);
      } else {
        data[idx + 0] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }

  /**
   * Update simulation each frame
   */
  update(
    time: number,
    deltaTime: number,
    orbRadius: number,
    pointerLocal: THREE.Vector3 | null,
    pointerEnergy: number
  ): void {
    // Clamp deltaTime to prevent physics explosion on tab switch
    const dt = Math.min(deltaTime, 0.05);

    // Update position uniforms
    const posUniforms = this.positionVariable.material
      .uniforms as unknown as ParticleComputeUniforms;
    posUniforms.uTime.value = time;
    posUniforms.uDeltaTime.value = dt;
    posUniforms.uOrbRadius.value = orbRadius;
    if (pointerLocal) {
      posUniforms.uPointerLocal.value.copy(pointerLocal);
    } else {
      posUniforms.uPointerLocal.value.set(0, 0, -999);
    }
    posUniforms.uPointerEnergy.value = pointerEnergy;

    // Animate density offset slowly
    const timeScale = 0.05;
    posUniforms.uDensityOffset.value.set(time * timeScale, time * timeScale * 0.9, time * timeScale * 1.1);

    // Update velocity uniforms
    const velUniforms = this.velocityVariable.material
      .uniforms as unknown as ParticleComputeUniforms;
    velUniforms.uTime.value = time;
    velUniforms.uDeltaTime.value = dt;
    velUniforms.uOrbRadius.value = orbRadius;
    if (pointerLocal) {
      velUniforms.uPointerLocal.value.copy(pointerLocal);
    } else {
      velUniforms.uPointerLocal.value.set(0, 0, -999);
    }
    velUniforms.uPointerEnergy.value = pointerEnergy;

    // Run compute
    this.gpuCompute.compute();
  }

  /**
   * Get current position texture for rendering
   */
  getPositionTexture(): THREE.Texture {
    return this.gpuCompute.getCurrentRenderTarget(this.positionVariable)
      .texture;
  }

  /**
   * Get current velocity texture (for debugging)
   */
  getVelocityTexture(): THREE.Texture {
    return this.gpuCompute.getCurrentRenderTarget(this.velocityVariable)
      .texture;
  }

  /**
   * Get texture dimensions for UV calculation
   */
  getTextureDimensions(): { width: number; height: number } {
    return { width: this.textureWidth, height: this.textureHeight };
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.gpuCompute.dispose();
  }
}
