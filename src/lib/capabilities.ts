export type SimTextureType = "half-float" | "float";

export interface Capabilities {
  hasWebGL2: boolean;
  hasFloatRT: boolean;
  hasHalfFloatRT: boolean;
  hasFloatLinear: boolean;
  preferredSimTextureType: SimTextureType;
}

export interface BloomParams {
  intensity: number;
  luminanceThreshold: number;
  luminanceSmoothing: number;
  radius: number;
}

export interface SceneVisualConfig {
  dpr: number;
  innerParticleLayerSizes: [number, number, number, number];
  outerSparkleCount: number;
  sphereSegments: [number, number];
  bloom: BloomParams;
}

export const SCENE_VISUAL_CONFIG: SceneVisualConfig = {
  dpr: 2,
  innerParticleLayerSizes: [240, 160, 16, 7],
  outerSparkleCount: 2400,
  sphereSegments: [256, 256],
  bloom: {
    intensity: 0.36,
    luminanceThreshold: 0.38,
    luminanceSmoothing: 0.2,
    radius: 0.5,
  },
};

function cleanupRenderTargetTest(
  gl: WebGL2RenderingContext,
  framebuffer: WebGLFramebuffer | null,
  texture: WebGLTexture | null
) {
  if (framebuffer) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
  }

  if (texture) {
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteTexture(texture);
  }
}

function testRenderTargetSupport(
  gl: WebGL2RenderingContext,
  internalFormat: number,
  type: number
): boolean {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  if (!texture || !framebuffer) {
    cleanupRenderTargetTest(gl, framebuffer, texture);
    return false;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 1, 1, 0, gl.RGBA, type, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const isSupported = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  cleanupRenderTargetTest(gl, framebuffer, texture);
  return isSupported;
}

let cachedCapabilities: Capabilities | null = null;

export function detectCapabilities(): Capabilities {
  if (cachedCapabilities) return cachedCapabilities;

  const defaults: Capabilities = {
    hasWebGL2: false,
    hasFloatRT: false,
    hasHalfFloatRT: false,
    hasFloatLinear: false,
    preferredSimTextureType: "float",
  };

  if (typeof document === "undefined") {
    return defaults;
  }

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");

  if (!gl) {
    cachedCapabilities = defaults;
    return defaults;
  }

  const hasFloatLinear = gl.getExtension("OES_texture_float_linear") !== null;
  const hasFloatRT = testRenderTargetSupport(gl, gl.RGBA32F, gl.FLOAT);
  const hasHalfFloatRT = testRenderTargetSupport(gl, gl.RGBA16F, gl.HALF_FLOAT);

  cachedCapabilities = {
    hasWebGL2: true,
    hasFloatRT,
    hasHalfFloatRT,
    hasFloatLinear,
    preferredSimTextureType: hasFloatRT ? "float" : "half-float",
  };

  return cachedCapabilities;
}

export function logCapabilities(): void {
  const caps = detectCapabilities();

  console.group("WebGL Capabilities");
  console.log("WebGL2:", caps.hasWebGL2 ? "yes" : "no");
  console.log("Float RT:", caps.hasFloatRT ? "yes" : "no");
  console.log("Half Float RT:", caps.hasHalfFloatRT ? "yes" : "no");
  console.log("Float Linear:", caps.hasFloatLinear ? "yes" : "no");
  console.log("Preferred Simulation Texture:", caps.preferredSimTextureType);
  console.groupEnd();
}
