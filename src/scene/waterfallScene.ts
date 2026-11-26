import * as THREE from 'three';
import { createCameraController } from './cameraController';
import { createIcelandicCliff } from './cliff';
import { createIcelandicLighting } from './lighting';
import { createWaterfallParticles } from './particles';
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

export function createWaterfallScene(container: HTMLElement): WaterfallSceneController {
  const initialWidth = Math.max(container.clientWidth, 1);
  const initialHeight = Math.max(container.clientHeight, 1);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    stencil: false,
  });

  const isSoftwareGpu = detectSoftwareRenderer(renderer);
  const maxPixelRatio = isSoftwareGpu ? 0.85 : 1.75;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(initialWidth, initialHeight);
  renderer.shadowMap.enabled = !isSoftwareGpu;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(44, initialWidth / initialHeight, 0.25, 420);
  const cameraController = createCameraController({
    camera,
    domElement: renderer.domElement,
  });

  const noiseTexture = createProceduralNoiseTexture();

  const sky = createIcelandicSky({ renderer, noiseTexture });
  scene.add(sky.mesh);
  scene.environment = sky.environmentTexture;

  const lighting = createIcelandicLighting(scene);
  scene.add(lighting.group);

  const cliff = createIcelandicCliff(noiseTexture);
  scene.add(cliff.group);

  const waterPool = createGlacialWaterPool(noiseTexture);
  scene.add(waterPool.mesh);

  const waterfall = createIcelandicWaterfall(noiseTexture);
  scene.add(waterfall.group);

  const particles = createWaterfallParticles({
    initialPixelRatio: pixelRatio,
    noiseTexture,
    reducedOverdraw: isSoftwareGpu,
  });
  scene.add(particles.group);

  const postProcessing = createPostProcessing({
    renderer,
    scene,
    camera,
    width: initialWidth,
    height: initialHeight,
    samples: isSoftwareGpu ? 0 : 2,
  });

  const clock = new THREE.Clock();
  let animationFrameId = 0;
  let disposed = false;

  const handleResize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const updatedPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(updatedPixelRatio);
    renderer.setSize(width, height);
    postProcessing.resize({ width, height });
    particles.setPixelRatio(updatedPixelRatio);
  };

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(animationFrameId);
  };

  const handleContextRestored = () => {
    if (!disposed) {
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
    waterPool.update(elapsedSeconds);
    waterfall.update(elapsedSeconds);
    particles.update(elapsedSeconds);

    postProcessing.render(elapsedSeconds);
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
      particles.dispose();
      waterfall.dispose();
      waterPool.dispose();
      cliff.dispose();
      lighting.dispose();
      sky.dispose();
      noiseTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
