import * as THREE from 'three';
import { createCameraController } from './cameraController';
import { CliffSystem, createIcelandicCliff } from './cliff';
import { FoliageSystem, createHighlandFoliage } from './foliage';
import { ForestVegetationSystem, createForestVegetation } from './forestVegetation';
import { LightingSystem, createIcelandicLighting } from './lighting';
import { ParticleSystem, createWaterfallParticles } from './particles';
import { createWaterfallTextureBundle } from './pbrTextures';
import { createPostProcessing } from './postprocessing';
import { createProceduralNoiseTexture } from './proceduralTextures';
import { SkySystem, createIcelandicSky } from './sky';
import { createGlacialWaterPool } from './waterPool';
import { WaterfallSystem, createIcelandicWaterfall } from './waterfall';
import {
  WATERFALL_PRESETS,
  WaterfallPresetConfig,
  WaterfallPresetId,
  getNextWaterfallPresetId,
} from './waterfallPresets';

export interface WaterfallSceneController {
  readonly getPreset: () => WaterfallPresetConfig;
  readonly switchWaterfall: () => WaterfallPresetConfig;
  readonly toggleDrift: () => boolean;
  readonly resetCameraView: () => void;
  readonly dispose: () => void;
}

interface ActiveBiomeInstances {
  readonly preset: WaterfallPresetConfig;
  readonly sky: SkySystem;
  readonly lighting: LightingSystem;
  readonly cliff: CliffSystem;
  readonly foliage: FoliageSystem | null;
  readonly forestVegetation: ForestVegetationSystem | null;
  readonly waterfall: WaterfallSystem;
  readonly particles: ParticleSystem;
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

  let currentRenderWidth = Math.max(1, Math.floor(initialWidth * pixelRatio));
  let currentRenderHeight = Math.max(1, Math.floor(initialHeight * pixelRatio));
  const reflWidth = Math.max(1, Math.floor(currentRenderWidth * 0.5));
  const reflHeight = Math.max(1, Math.floor(currentRenderHeight * 0.5));

  const initialPreset = WATERFALL_PRESETS.iceland;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, initialWidth / initialHeight, 0.25, 520);
  const reflectionCamera = new THREE.PerspectiveCamera(46, initialWidth / initialHeight, 0.25, 520);
  const cameraController = createCameraController({
    camera,
    domElement: renderer.domElement,
    initialPosition: initialPreset.heroCameraPosition,
    initialTarget: initialPreset.heroCameraTarget,
  });

  const fallbackData = new Uint8Array([255, 255, 255, 255]);
  const fallbackTexture = new THREE.DataTexture(fallbackData, 1, 1, THREE.RGBAFormat);
  fallbackTexture.needsUpdate = true;

  const noiseTexture = createProceduralNoiseTexture();
  const textures = createWaterfallTextureBundle({ renderer, isSoftwareGpu });
  const maxAnisotropy = isSoftwareGpu ? 2 : Math.min(16, renderer.capabilities.getMaxAnisotropy());

  const waterPool = createGlacialWaterPool({
    noiseTexture,
    foamTexture: textures.waterfallFoam,
    fallbackTexture,
    preset: initialPreset,
  });
  scene.add(waterPool.mesh);

  let opaqueTarget = createOpaqueDepthTarget({
    width: currentRenderWidth,
    height: currentRenderHeight,
  });
  let compositeTarget = new THREE.WebGLRenderTarget(currentRenderWidth, currentRenderHeight, {
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
    preset: initialPreset,
  });

  let shadowRefreshNeeded = true;

  const disposeBiome = (biome: ActiveBiomeInstances) => {
    scene.remove(biome.sky.mesh);
    scene.remove(biome.lighting.group);
    scene.remove(biome.cliff.group);
    if (biome.foliage) {
      scene.remove(biome.foliage.mesh);
      biome.foliage.dispose();
    }
    if (biome.forestVegetation) {
      scene.remove(biome.forestVegetation.group);
      biome.forestVegetation.dispose();
    }
    scene.remove(biome.waterfall.group);
    scene.remove(biome.particles.group);

    biome.sky.dispose();
    biome.lighting.dispose();
    biome.cliff.dispose();
    biome.waterfall.dispose();
    biome.particles.dispose();
  };

  const buildBiome = (presetId: WaterfallPresetId): ActiveBiomeInstances => {
    const preset = WATERFALL_PRESETS[presetId];
    const sky = createIcelandicSky({ renderer, noiseTexture, preset });
    scene.add(sky.mesh);
    scene.environment = sky.environmentTexture;

    const lighting = createIcelandicLighting({ scene, isSoftwareGpu, preset });
    scene.add(lighting.group);

    const cliff = createIcelandicCliff({
      noiseTexture,
      textures,
      anisotropy: maxAnisotropy,
      presetId,
      onStaticGeometryChanged: () => {
        shadowRefreshNeeded = true;
      },
    });
    scene.add(cliff.group);

    let foliage: FoliageSystem | null = null;
    let forestVegetation: ForestVegetationSystem | null = null;
    if (presetId === 'forest') {
      forestVegetation = createForestVegetation({
        preset,
        textures,
        anisotropy: maxAnisotropy,
        isSoftwareGpu,
        fallbackShadowTexture: fallbackTexture,
        onStaticGeometryChanged: () => {
          shadowRefreshNeeded = true;
        },
      });
      scene.add(forestVegetation.group);
    } else {
      foliage = createHighlandFoliage({
        isSoftwareGpu,
        fallbackShadowTexture: fallbackTexture,
      });
      scene.add(foliage.mesh);
    }

    const waterfall = createIcelandicWaterfall({
      noiseTexture,
      foamTexture: textures.waterfallFoam,
      fallbackTexture,
      preset,
    });
    scene.add(waterfall.group);

    const particles = createWaterfallParticles({
      noiseTexture,
      fallbackTexture,
      reducedOverdraw: isSoftwareGpu,
      preset,
    });
    scene.add(particles.group);

    waterPool.applyPreset(preset);
    postProcessing.applyPreset(preset);
    shadowRefreshNeeded = true;

    return {
      preset,
      sky,
      lighting,
      cliff,
      foliage,
      forestVegetation,
      waterfall,
      particles,
    };
  };

  let activeBiome = buildBiome('iceland');

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
    activeBiome.waterfall.setSceneTextures({
      colorTexture: opaqueTarget.texture,
      depthTexture: depthTex,
      width: dims.width,
      height: dims.height,
      cameraNear: camera.near,
      cameraFar: camera.far,
    });
    activeBiome.particles.setSceneTextures({
      depthTexture: depthTex,
      width: dims.width,
      height: dims.height,
      cameraNear: camera.near,
      cameraFar: camera.far,
    });
    blitPass.setTexture(opaqueTarget.texture);
  };

  syncSceneTargetUniforms({ width: currentRenderWidth, height: currentRenderHeight });

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
    currentRenderWidth = Math.max(1, Math.floor(width * updatedPixelRatio));
    currentRenderHeight = Math.max(1, Math.floor(height * updatedPixelRatio));
    const nextReflW = Math.max(1, Math.floor(currentRenderWidth * 0.5));
    const nextReflH = Math.max(1, Math.floor(currentRenderHeight * 0.5));

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(updatedPixelRatio);
    renderer.setSize(width, height);

    opaqueTarget.depthTexture?.dispose();
    opaqueTarget.dispose();
    opaqueTarget = createOpaqueDepthTarget({
      width: currentRenderWidth,
      height: currentRenderHeight,
    });

    compositeTarget.setSize(currentRenderWidth, currentRenderHeight);
    reflectionTarget.setSize(nextReflW, nextReflH);
    postProcessing.resize({ width, height });
    syncSceneTargetUniforms({ width: currentRenderWidth, height: currentRenderHeight });
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

  const setVegetationVisible = (visible: boolean) => {
    if (activeBiome.foliage) {
      activeBiome.foliage.mesh.visible = visible;
    }
    if (activeBiome.forestVegetation) {
      activeBiome.forestVegetation.group.visible = visible;
    }
  };

  const animate = () => {
    if (disposed) {
      return;
    }

    animationFrameId = requestAnimationFrame(animate);
    const deltaSeconds = clock.getDelta();
    const elapsedSeconds = clock.elapsedTime;

    cameraController.update({ elapsedSeconds, deltaSeconds });
    activeBiome.sky.update(elapsedSeconds);
    activeBiome.lighting.update(elapsedSeconds);
    activeBiome.cliff.update(elapsedSeconds);
    activeBiome.foliage?.update(elapsedSeconds);
    activeBiome.forestVegetation?.update(elapsedSeconds);
    waterPool.update(elapsedSeconds);
    activeBiome.waterfall.update(elapsedSeconds);
    activeBiome.particles.update(elapsedSeconds);

    if (shadowRefreshNeeded) {
      waterPool.mesh.visible = false;
      activeBiome.waterfall.group.visible = false;
      activeBiome.particles.group.visible = false;
      if (activeBiome.foliage) {
        activeBiome.foliage.mesh.visible = false;
      }
      if (activeBiome.forestVegetation) {
        activeBiome.forestVegetation.group.visible = true;
      }
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(opaqueTarget);
      renderer.render(scene, camera);
      shadowRefreshNeeded = false;
    }

    const activeShadowTex = activeBiome.lighting.sunLight.shadow.map?.texture ?? fallbackTexture;
    const shadowConfig = {
      shadowMap: activeShadowTex,
      shadowMatrix: activeBiome.lighting.sunLight.shadow.matrix,
      shadowMapSize: activeBiome.lighting.shadowMapSize,
    };
    activeBiome.foliage?.setShadowUniforms(shadowConfig);
    activeBiome.forestVegetation?.setShadowUniforms(shadowConfig);
    waterPool.setShadowUniforms(shadowConfig);
    activeBiome.waterfall.setShadowUniforms(shadowConfig);
    activeBiome.particles.setShadowUniforms(shadowConfig);

    updateMirroredReflectionCamera();
    waterPool.mesh.visible = false;
    activeBiome.particles.group.visible = false;
    if (activeBiome.foliage) {
      activeBiome.foliage.mesh.visible = false;
    }
    if (activeBiome.forestVegetation) {
      activeBiome.forestVegetation.group.visible = true;
    }
    activeBiome.waterfall.group.visible = true;
    activeBiome.waterfall.setUseDepthPass(false);
    renderer.clippingPlanes = waterReflectionClipPlanes;
    renderer.setRenderTarget(reflectionTarget);
    renderer.clear();
    renderer.render(scene, reflectionCamera);
    renderer.clippingPlanes = noClipPlanes;
    activeBiome.waterfall.setUseDepthPass(true);

    activeBiome.waterfall.group.visible = false;
    waterPool.mesh.visible = false;
    activeBiome.particles.group.visible = false;
    setVegetationVisible(true);
    renderer.setRenderTarget(opaqueTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(compositeTarget);
    renderer.clear();
    renderer.render(blitPass.scene, blitPass.camera);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    activeBiome.sky.mesh.visible = false;
    activeBiome.cliff.group.visible = false;
    setVegetationVisible(false);
    waterPool.mesh.visible = true;
    activeBiome.waterfall.group.visible = true;
    activeBiome.particles.group.visible = true;
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;

    activeBiome.sky.mesh.visible = true;
    activeBiome.cliff.group.visible = true;
    setVegetationVisible(true);

    postProcessing.render({
      elapsedSeconds,
      sourceColorTexture: compositeTarget.texture,
      sceneDepthTexture: opaqueTarget.depthTexture ?? fallbackTexture,
      camera,
      shadowMap: activeShadowTex,
      shadowMatrix: activeBiome.lighting.sunLight.shadow.matrix,
      shadowMapSize: activeBiome.lighting.shadowMapSize,
    });
  };

  animationFrameId = requestAnimationFrame(animate);

  return {
    getPreset: () => activeBiome.preset,
    switchWaterfall: () => {
      const nextId = getNextWaterfallPresetId(activeBiome.preset.id);
      disposeBiome(activeBiome);
      activeBiome = buildBiome(nextId);
      syncSceneTargetUniforms({ width: currentRenderWidth, height: currentRenderHeight });
      cameraController.setHeroPose({
        position: activeBiome.preset.heroCameraPosition,
        target: activeBiome.preset.heroCameraTarget,
        immediate: true,
      });
      return activeBiome.preset;
    },
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
      disposeBiome(activeBiome);
      waterPool.dispose();
      textures.dispose();
      noiseTexture.dispose();
      fallbackTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
