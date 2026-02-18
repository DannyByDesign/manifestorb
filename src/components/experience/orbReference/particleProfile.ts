export type ParticleProfile = {
  seed: number;
  spawnCore: number;
  spawnShell: number;
  lobeBias: number;
  radialTightness: number;
  edgeScatter: number;
  driftStrength: number;
  turbulenceStrength: number;
  shearStrength: number;
  breathStrength: number;
  compression: number;
  confinement: number;
  curlMix: number;
  densityBias: number;
  alphaBase: number;
  alphaBoost: number;
  darkTintMix: number;
  glintChance: number;
  depthFade: number;
};

export const DEFAULT_PARTICLE_PROFILE: ParticleProfile = {
  seed: 0.13,
  spawnCore: 0.5,
  spawnShell: 0.4,
  lobeBias: 0.55,
  radialTightness: 0.65,
  edgeScatter: 0.45,
  driftStrength: 0.8,
  turbulenceStrength: 0.65,
  shearStrength: 0.45,
  breathStrength: 0.2,
  compression: 0.5,
  confinement: 0.8,
  curlMix: 0.52,
  densityBias: 0.08,
  alphaBase: 0.6,
  alphaBoost: 0.52,
  darkTintMix: 0.55,
  glintChance: 0.02,
  depthFade: 0.24,
};
