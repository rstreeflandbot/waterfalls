import * as THREE from 'three';
import { createCameraController } from './cameraController';
import { createIcelandicCliff } from './cliff';
import { createHighlandFoliage } from './foliage';
import { createIcelandicLighting } from './lighting';
import { createWaterfallParticles } from './particles';
import { createWaterfallTextureBundle } from './pbrTextures';
import { createPostProcessing } from './postprocessing';
import { createProceduralNoiseTexture } from './proceduralTextures';
import { createIcelandicSky } from './sky';
import { createGlacialWaterPool } from './waterPool';
import { createIcelandicWaterfall } from './waterfall';

export interface WaterfallSceneController {
  readonly toggleDrift: () => boolean;
  readonly resetCameraView: () => void;
  readonly dispose: () => void;
}

function detectSoftwareRenderer(renderer: THREE.WebGLRenderer): boolean {
  const gl = renderer.getContext();
  const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
  const rawName = debugExt
    ? gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  if (typeof rawName !== 'string') {
    return false;
  }
  return /swiftshader|llvmpipe|software|mesa offscreen/i.test(rawName);
}

function createOpaqueDepthTarget(options: {
  readonly width: number;
  readonly height: number;
}): THREE.WebGLRenderTarget {
  const depthTexture = new THREE.DepthTexture(options.width, options.height);
  depthTexture.type = THREE.UnsignedIntType;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;

  return new THREE.WebGLRenderTarget(options.width, options.height, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    depthTexture,
  });
}

function createFullscreenBlitPass(sourceTexture: THREE.Texture): {
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly setTexture: (tex: THREE.Texture) => void;
  readonly dispose: () => void;
} {
  const blitScene = new THREE.Scene();
  const blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uniforms = {
    tSource: { value: sourceTexture },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(tSource, vUv);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(geometry, material);
  blitScene.add(quad);

  return {
    scene: blitScene,
    camera: blitCamera,
    setTexture: (tex: THREE.Texture) => {
      uniforms.tSource.value = tex;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createWaterfallScene(container: HTMLElement): WaterfallSceneController {
  const initialWidth = Math.max(container.clientWidth, 1);
  const initialHeight = Math.max(container.clientHeight, 1);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });

  const isSoftwareGpu = detectSoftwareRenderer(renderer);
  const maxPixelRatio = isSoftwareGpu ? 0.85 : 1.75;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(initialWidth, initialHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.localClippingEnabled = false;
  container.appendChild(renderer.domElement);

  const renderWidth = Math.max(1, Math.floor(initialWidth * pixelRatio));
  const renderHeight = Math.max(1, Math.floor(initialHeight * pixelRatio));
  const reflWidth = Math.max(1, Math.floor(renderWidth * 0.5));
  const reflHeight = Math.max(1, Math.floor(renderHeight * 0.5));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, initialWidth / initialHeight, 0.25, 520);
  const reflectionCamera = new THREE.PerspectiveCamera(46, initialWidth / initialHeight, 0.25, 520);
  const cameraController = createCameraController({
    camera,
    domElement: renderer.domElement,
  });

  const fallbackData = new Uint8Array([255, 255, 255, 255]);
  const fallbackTexture = new THREE.DataTexture(fallbackData, 1, 1, THREE.RGBAFormat);
  fallbackTexture.needsUpdate = true;

  const noiseTexture = createProceduralNoiseTexture();
  const textures = createWaterfallTextureBundle({ renderer, isSoftwareGpu });
  const maxAnisotropy = isSoftwareGpu ? 2 : Math.min(16, renderer.capabilities.getMaxAnisotropy());

  const sky = createIcelandicSky({ renderer, noiseTexture });
  scene.add(sky.mesh);
  scene.environment = sky.environmentTexture;

  const lighting = createIcelandicLighting({ scene, isSoftwareGpu });
  scene.add(lighting.group);

  let shadowRefreshNeeded = true;
  const cliff = createIcelandicCliff({
    noiseTexture,
    textures,
    anisotropy: maxAnisotropy,
    onStaticGeometryChanged: () => {
      shadowRefreshNeeded = true;
    },
  });
  scene.add(cliff.group);

  const foliage = createHighlandFoliage({
    isSoftwareGpu,
    fallbackShadowTexture: fallbackTexture,
  });
  scene.add(foliage.mesh);

  const waterPool = createGlacialWaterPool({
    noiseTexture,
    foamTexture: textures.waterfallFoam,
    fallbackTexture,
  });
  scene.add(waterPool.mesh);

  const waterfall = createIcelandicWaterfall({
    noiseTexture,
    foamTexture: textures.waterfallFoam,
    fallbackTexture,
  });
  scene.add(waterfall.group);

  const particles = createWaterfallParticles({
    noiseTexture,
    fallbackTexture,
    reducedOverdraw: isSoftwareGpu,
  });
  scene.add(particles.group);

  let opaqueTarget = createOpaqueDepthTarget({ width: renderWidth, height: renderHeight });
  let compositeTarget = new THREE.WebGLRenderTarget(renderWidth, renderHeight, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  let reflectionTarget = new THREE.WebGLRenderTarget(reflWidth, reflHeight, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });

  const blitPass = createFullscreenBlitPass(opaqueTarget.texture);

  const postProcessing = createPostProcessing({
    renderer,
    width: initialWidth,
    height: initialHeight,
    isSoftwareGpu,
  });

  const syncSceneTargetUniforms = (dims: { readonly width: number; readonly height: number }) => {
    const depthTex = opaqueTarget.depthTexture ?? fallbackTexture;
    waterPool.setSceneTextures({
      colorTexture: opaqueTarget.texture,
      depthTexture: depthTex,
      reflectionTexture: reflectionTarget.texture,
      width: dims.width,
      height: dims.height,
      cameraNear: camera.near,
      cameraFar: camera.far,
    });
    waterfall.setSceneTextures({
      colorTexture: opaqueTarget.texture,
      depthTexture: depthTex,
      width: dims.width,
      height: dims.height,
      cameraNear: camera.near,
      cameraFar: camera.far,
    });
    particles.setSceneTextures({
      depthTexture: depthTex,
      width: dims.width,
      height: dims.height,
      cameraNear: camera.near,
      cameraFar: camera.far,
    });
    blitPass.setTexture(opaqueTarget.texture);
  };

  syncSceneTargetUniforms({ width: renderWidth, height: renderHeight });

  const clock = new THREE.Clock();
  let animationFrameId = 0;
  let disposed = false;

  const mirrorLookTarget = new THREE.Vector3();
  const forwardVec = new THREE.Vector3();
  const waterReflectionClipPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.05)];
  const noClipPlanes: THREE.Plane[] = [];

  const updateMirroredReflectionCamera = () => {
    camera.getWorldDirection(forwardVec);
    mirrorLookTarget.copy(camera.position).add(forwardVec);

    reflectionCamera.fov = camera.fov;
    reflectionCamera.aspect = camera.aspect;
    reflectionCamera.near = camera.near;
    reflectionCamera.far = camera.far;
    reflectionCamera.position.set(camera.position.x, -camera.position.y, camera.position.z);
    reflectionCamera.up.set(0, 1, 0);
    reflectionCamera.lookAt(mirrorLookTarget.x, -mirrorLookTarget.y, mirrorLookTarget.z);
    reflectionCamera.updateProjectionMatrix();
    reflectionCamera.updateMatrixWorld();
  };

  const handleResize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const updatedPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    const nextRenderW = Math.max(1, Math.floor(width * updatedPixelRatio));
    const nextRenderH = Math.max(1, Math.floor(height * updatedPixelRatio));
    const nextReflW = Math.max(1, Math.floor(nextRenderW * 0.5));
    const nextReflH = Math.max(1, Math.floor(nextRenderH * 0.5));

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(updatedPixelRatio);
    renderer.setSize(width, height);

    opaqueTarget.depthTexture?.dispose();
    opaqueTarget.dispose();
    opaqueTarget = createOpaqueDepthTarget({ width: nextRenderW, height: nextRenderH });

    compositeTarget.setSize(nextRenderW, nextRenderH);
    reflectionTarget.setSize(nextReflW, nextReflH);
    postProcessing.resize({ width, height });
    syncSceneTargetUniforms({ width: nextRenderW, height: nextRenderH });
  };

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(animationFrameId);
  };

  const handleContextRestored = () => {
    if (!disposed) {
      shadowRefreshNeeded = true;
      clock.getDelta();
      animationFrameId = requestAnimationFrame(animate);
    }
  };

  window.addEventListener('resize', handleResize);
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

  const animate = () => {
    if (disposed) {
      return;
    }

    animationFrameId = requestAnimationFrame(animate);
    const deltaSeconds = clock.getDelta();
    const elapsedSeconds = clock.elapsedTime;

    cameraController.update({ elapsedSeconds, deltaSeconds });
    sky.update(elapsedSeconds);
    lighting.update(elapsedSeconds);
    cliff.update(elapsedSeconds);
    foliage.update(elapsedSeconds);
    waterPool.update(elapsedSeconds);
    waterfall.update(elapsedSeconds);
    particles.update(elapsedSeconds);

    if (shadowRefreshNeeded) {
      waterPool.mesh.visible = false;
      waterfall.group.visible = false;
      particles.group.visible = false;
      foliage.mesh.visible = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(opaqueTarget);
      renderer.render(scene, camera);
      shadowRefreshNeeded = false;
    }

    const activeShadowTex = lighting.sunLight.shadow.map?.texture ?? fallbackTexture;
    const shadowConfig = {
      shadowMap: activeShadowTex,
      shadowMatrix: lighting.sunLight.shadow.matrix,
      shadowMapSize: lighting.shadowMapSize,
    };
    foliage.setShadowUniforms(shadowConfig);
    waterPool.setShadowUniforms(shadowConfig);
    waterfall.setShadowUniforms(shadowConfig);
    particles.setShadowUniforms(shadowConfig);

    updateMirroredReflectionCamera();
    waterPool.mesh.visible = false;
    particles.group.visible = false;
    foliage.mesh.visible = false;
    waterfall.group.visible = true;
    waterfall.setUseDepthPass(false);
    renderer.clippingPlanes = waterReflectionClipPlanes;
    renderer.setRenderTarget(reflectionTarget);
    renderer.clear();
    renderer.render(scene, reflectionCamera);
    renderer.clippingPlanes = noClipPlanes;
    waterfall.setUseDepthPass(true);

    waterfall.group.visible = false;
    waterPool.mesh.visible = false;
    particles.group.visible = false;
    foliage.mesh.visible = true;
    renderer.setRenderTarget(opaqueTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(compositeTarget);
    renderer.clear();
    renderer.render(blitPass.scene, blitPass.camera);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    sky.mesh.visible = false;
    cliff.group.visible = false;
    foliage.mesh.visible = false;
    waterPool.mesh.visible = true;
    waterfall.group.visible = true;
    particles.group.visible = true;
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;

    sky.mesh.visible = true;
    cliff.group.visible = true;
    foliage.mesh.visible = true;

    postProcessing.render({
      elapsedSeconds,
      sourceColorTexture: compositeTarget.texture,
      sceneDepthTexture: opaqueTarget.depthTexture ?? fallbackTexture,
      camera,
      shadowMap: activeShadowTex,
      shadowMatrix: lighting.sunLight.shadow.matrix,
      shadowMapSize: lighting.shadowMapSize,
    });
  };

  animationFrameId = requestAnimationFrame(animate);

  return {
    toggleDrift: () => {
      const nextState = !cameraController.isDriftEnabled();
      cameraController.setDriftEnabled(nextState);
      return nextState;
    },
    resetCameraView: () => {
      cameraController.resetView();
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      cameraController.dispose();
      postProcessing.dispose();
      blitPass.dispose();
      opaqueTarget.depthTexture?.dispose();
      opaqueTarget.dispose();
      compositeTarget.dispose();
      reflectionTarget.dispose();
      particles.dispose();
      waterfall.dispose();
      waterPool.dispose();
      foliage.dispose();
      cliff.dispose();
      lighting.dispose();
      sky.dispose();
      textures.dispose();
      noiseTexture.dispose();
      fallbackTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
