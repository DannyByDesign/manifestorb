import * as THREE from "three";

const hash01 = (index: number, salt: number): number => {
  const x = Math.sin((index + 1) * 127.1 + salt * 311.7) * 43758.5453123;
  return x - Math.floor(x);
};

const getRandomData = (width: number, height: number) => {
  const length = width * height * 4;
  const data = new Float32Array(length);

  for (let i = 0; i < length; i += 4) {
    const index = i / 4;

    // Deterministic uniform distribution inside unit sphere.
    const u = hash01(index, 0.13);
    const v = hash01(index, 0.41);
    const w = hash01(index, 0.77);

    const r = Math.cbrt(u);
    const theta = 2.0 * Math.PI * v;
    const phi = Math.acos(2.0 * w - 1.0);

    const sinPhi = Math.sin(phi);
    const x = r * sinPhi * Math.cos(theta);
    const y = r * sinPhi * Math.sin(theta);
    const z = r * Math.cos(phi);

    data[i] = x;
    data[i + 1] = y;
    data[i + 2] = z;
    data[i + 3] = 1.0;
  }

  return data;
};

class SimulationMaterial extends THREE.ShaderMaterial {
  private readonly positionsTexture: THREE.DataTexture;

  constructor(size: number, vertexShader: string, fragmentShader: string, frequency = 0.15) {
    const positionsTexture = new THREE.DataTexture(
      getRandomData(size, size),
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
