import * as THREE from "three";
import {
  DEFAULT_PARTICLE_PROFILE,
  type ParticleProfile,
} from "@/components/experience/orbReference/particleProfile";

const hash01 = (index: number, salt: number): number => {
  const x = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

const getRandomData = (width: number, height: number, profile: ParticleProfile) => {
  const length = width * height * 4;
  const data = new Float32Array(length);

  for (let i = 0; i < length; i += 4) {
    const index = i / 4;
    const seeded = profile.seed * 19.173;
    const u = hash01(index, 0.13 + seeded);
    const v = hash01(index, 0.41 + seeded);
    const w = hash01(index, 0.77 + seeded);
    const archetypeRoll = hash01(index, 1.07 + seeded);

    const coreCutoff = Math.min(0.92, Math.max(0.08, profile.spawnCore));
    const shellCutoff = Math.min(
      0.98,
      Math.max(coreCutoff + 0.02, coreCutoff + profile.spawnShell * (1.0 - coreCutoff))
    );

    let r = 0;
    if (archetypeRoll < coreCutoff) {
      r = Math.pow(u, 1.6 + profile.radialTightness * 1.2) * 0.58;
    } else if (archetypeRoll < shellCutoff) {
      r = 0.34 + Math.pow(u, 0.65 + (1.0 - profile.radialTightness) * 0.35) * 0.36;
    } else {
      r = 0.72 + u * (0.2 + profile.edgeScatter * 0.15);
    }

    const theta = 2.0 * Math.PI * v;
    const phi = Math.acos(2.0 * w - 1.0);

    const sinPhi = Math.sin(phi);
    let x = r * sinPhi * Math.cos(theta);
    let y = r * sinPhi * Math.sin(theta);
    let z = r * Math.cos(phi);

    // Build an asymmetric lobe field so density naturally forms plume-like pockets.
    const lobeA = {
      x: 0.34 + profile.seed * 0.12,
      y: 0.1 - profile.seed * 0.08,
      z: 0.18,
    };
    const lobeB = {
      x: -0.26,
      y: 0.22 + profile.seed * 0.05,
      z: -0.14,
    };

    const toA = { x: x - lobeA.x, y: y - lobeA.y, z: z - lobeA.z };
    const toB = { x: x - lobeB.x, y: y - lobeB.y, z: z - lobeB.z };

    const dA = Math.sqrt(toA.x * toA.x + toA.y * toA.y + toA.z * toA.z);
    const dB = Math.sqrt(toB.x * toB.x + toB.y * toB.y + toB.z * toB.z);

    const lobeWeight = profile.lobeBias * (0.5 + 0.5 * hash01(index, 1.63 + seeded));
    const lobePullA = Math.max(0, 1.0 - dA * 1.55) * lobeWeight;
    const lobePullB = Math.max(0, 1.0 - dB * 1.45) * lobeWeight * 0.9;

    x += (lobeA.x - x) * lobePullA + (lobeB.x - x) * lobePullB;
    y += (lobeA.y - y) * lobePullA + (lobeB.y - y) * lobePullB;
    z += (lobeA.z - z) * lobePullA + (lobeB.z - z) * lobePullB;

    // Small seeded anisotropy to avoid perfectly isotropic clouds.
    const skew = (hash01(index, 2.17 + seeded) - 0.5) * 0.1;
    x += skew * (0.8 + profile.lobeBias * 0.4);
    y -= skew * 0.35;
    z += skew * 0.5;

    const len = Math.sqrt(x * x + y * y + z * z);
    if (len > 0.98) {
      const s = 0.98 / len;
      x *= s;
      y *= s;
      z *= s;
    }

    data[i] = x;
    data[i + 1] = y;
    data[i + 2] = z;
    data[i + 3] = 1.0;
  }

  return data;
};

class SimulationMaterial extends THREE.ShaderMaterial {
  private readonly positionsTexture: THREE.DataTexture;

  constructor(
    size: number,
    vertexShader: string,
    fragmentShader: string,
    frequency = 0.15,
    profileOverrides: Partial<ParticleProfile> = {}
  ) {
    const profile: ParticleProfile = {
      ...DEFAULT_PARTICLE_PROFILE,
      ...profileOverrides,
    };

    const positionsTexture = new THREE.DataTexture(
      getRandomData(size, size, profile),
      size,
      size,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    positionsTexture.needsUpdate = true;

    const simulationUniforms = {
      positions: { value: positionsTexture },
      uFrequency: { value: frequency },
      uTime: { value: 0 },
      uDriftStrength: { value: profile.driftStrength },
      uTurbulenceStrength: { value: profile.turbulenceStrength },
      uShearStrength: { value: profile.shearStrength },
      uBreathStrength: { value: profile.breathStrength },
      uCompression: { value: profile.compression },
      uConfinement: { value: profile.confinement },
      uCurlMix: { value: profile.curlMix },
    };

    super({
      uniforms: simulationUniforms,
      vertexShader,
      fragmentShader,
    });

    this.positionsTexture = positionsTexture;
  }

  dispose(): void {
    this.positionsTexture.dispose();
    super.dispose();
  }
}

export default SimulationMaterial;
