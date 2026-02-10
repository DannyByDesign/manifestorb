import * as THREE from "three";

import fullscreenVert from "@/shaders/sim/fullscreen.vert";
import advectFrag from "@/shaders/sim/advect.frag";
import divergenceFrag from "@/shaders/sim/divergence.frag";
import pressureFrag from "@/shaders/sim/pressure.frag";
import gradientSubtractFrag from "@/shaders/sim/gradientSubtract.frag";
import splatFrag from "@/shaders/sim/splat.frag";

interface FluidFieldOptions {
  size: number;
  pressureIterations: number;
}

const DEFAULT_OPTS: FluidFieldOptions = {
  size: 128,
  pressureIterations: 10,
};

export class FluidField {
  private renderer: THREE.WebGLRenderer;
  private options: FluidFieldOptions;

  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;

  private velocityA: THREE.WebGLRenderTarget;
  private velocityB: THREE.WebGLRenderTarget;
  private pressureA: THREE.WebGLRenderTarget;
  private pressureB: THREE.WebGLRenderTarget;
  private divergence: THREE.WebGLRenderTarget;

  private advectMat: THREE.ShaderMaterial;
  private splatMat: THREE.ShaderMaterial;
  private divergenceMat: THREE.ShaderMaterial;
  private pressureMat: THREE.ShaderMaterial;
  private gradientMat: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, opts?: Partial<FluidFieldOptions>) {
    this.renderer = renderer;
    this.options = { ...DEFAULT_OPTS, ...opts };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial());
    this.scene.add(this.quad);

    this.velocityA = this.createRT();
    this.velocityB = this.createRT();
    this.pressureA = this.createRT();
    this.pressureB = this.createRT();
    this.divergence = this.createRT();

    const texel = new THREE.Vector2(1 / this.options.size, 1 / this.options.size);

    this.advectMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: advectFrag,
      uniforms: {
        tVelocity: { value: null as THREE.Texture | null },
        uTexelSize: { value: texel.clone() },
        uDelta: { value: 1 / 60 },
        uDissipation: { value: 0.985 },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.splatMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: splatFrag,
      uniforms: {
        tVelocity: { value: null as THREE.Texture | null },
        uTime: { value: 0 },
        uDelta: { value: 1 / 60 },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uMouseStrength: { value: 0 },
        uAspect: { value: 1.0 },
        uMacroStrength: { value: 0.9 },
        uMesoStrength: { value: 0.75 },
        uMicroStrength: { value: 0.35 },
        uVortexStrength: { value: 0.8 },
        uBreathSpeed: { value: 0.23 },
        uMaxSpeed: { value: 2.2 },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.divergenceMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: divergenceFrag,
      uniforms: {
        tVelocity: { value: null as THREE.Texture | null },
        uTexelSize: { value: texel.clone() },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.pressureMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: pressureFrag,
      uniforms: {
        tPressure: { value: null as THREE.Texture | null },
        tDivergence: { value: null as THREE.Texture | null },
        uTexelSize: { value: texel.clone() },
      },
      depthWrite: false,
      depthTest: false,
    });

    this.gradientMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert,
      fragmentShader: gradientSubtractFrag,
      uniforms: {
        tVelocity: { value: null as THREE.Texture | null },
        tPressure: { value: null as THREE.Texture | null },
        uTexelSize: { value: texel.clone() },
      },
      depthWrite: false,
      depthTest: false,
    });
  }

  private createRT() {
    const rt = new THREE.WebGLRenderTarget(this.options.size, this.options.size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    rt.texture.name = "fluid-field-rt";
    return rt;
  }

  private renderPass(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    const prev = this.renderer.getRenderTarget();
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
  }

  private swapVelocity() {
    const tmp = this.velocityA;
    this.velocityA = this.velocityB;
    this.velocityB = tmp;
  }

  private swapPressure() {
    const tmp = this.pressureA;
    this.pressureA = this.pressureB;
    this.pressureB = tmp;
  }

  update(time: number, deltaTime: number, pointer: THREE.Vector2, pointerEnergy: number, aspect: number) {
    const dt = Math.min(deltaTime, 0.05);

    this.advectMat.uniforms.tVelocity.value = this.velocityA.texture;
    this.advectMat.uniforms.uDelta.value = dt;
    this.renderPass(this.advectMat, this.velocityB);
    this.swapVelocity();

    this.splatMat.uniforms.tVelocity.value = this.velocityA.texture;
    this.splatMat.uniforms.uTime.value = time;
    this.splatMat.uniforms.uDelta.value = dt;
    this.splatMat.uniforms.uAspect.value = aspect;
    this.splatMat.uniforms.uMouse.value.set(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5);
    this.splatMat.uniforms.uMouseStrength.value = pointerEnergy;
    this.renderPass(this.splatMat, this.velocityB);
    this.swapVelocity();

    this.divergenceMat.uniforms.tVelocity.value = this.velocityA.texture;
    this.renderPass(this.divergenceMat, this.divergence);

    this.pressureMat.uniforms.tDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.options.pressureIterations; i++) {
      this.pressureMat.uniforms.tPressure.value = this.pressureA.texture;
      this.renderPass(this.pressureMat, this.pressureB);
      this.swapPressure();
    }

    this.gradientMat.uniforms.tVelocity.value = this.velocityA.texture;
    this.gradientMat.uniforms.tPressure.value = this.pressureA.texture;
    this.renderPass(this.gradientMat, this.velocityB);
    this.swapVelocity();
  }

  getVelocityTexture() {
    return this.velocityA.texture;
  }

  dispose() {
    this.quad.geometry.dispose();

    this.advectMat.dispose();
    this.splatMat.dispose();
    this.divergenceMat.dispose();
    this.pressureMat.dispose();
    this.gradientMat.dispose();

    this.velocityA.dispose();
    this.velocityB.dispose();
    this.pressureA.dispose();
    this.pressureB.dispose();
    this.divergence.dispose();
  }
}
