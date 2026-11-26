import * as THREE from 'three';
import { LoadingOverlayState } from '../ui/hud';
import { createCameraController } from './cameraController';
import { CliffSystem, createIcelandicCliff } from './cliff';
import { FoliageSystem, createHighlandFoliage } from './foliage';
import { ForestVegetationSystem, createForestVegetation } from './forestVegetation';
import { LightingSystem, createIcelandicLighting } from './lighting';
import { ParticleSystem, createWaterfallParticles } from './particles';
import { ForestTextureSets, IcelandTextureSets, createWaterfallTextureBundle } from './pbrTextures';
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
  readonly switchWaterfall: () => Promise<WaterfallPresetConfig>;
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

function detectMobileDevice(): boolean {
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const coarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  return uaMobile || (coarsePointer && window.innerWidth <= 1024);
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

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function createWaterfallScene(options: {
  readonly container: HTMLElement;
  readonly onLoadProgress?: (state: LoadingOverlayState) => void;
}): WaterfallSceneController {
  const { container, onLoadProgress } = options;
  const initialWidth = Math.max(container.clientWidth, 1);
  const initialHeight = Math.max(container.clientHeight, 1);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: false,
  });

  const isSoftwareGpu = detectSoftwareRenderer(renderer);
  const isMobileGpu = !isSoftwareGpu && detectMobileDevice();
  const maxPixelRatio = isSoftwareGpu ? 0.85 : isMobileGpu ? 1.35 : 1.75;
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

  const reflectionScale = isMobileGpu ? 0.35 : 0.5;
  let currentRenderWidth = Math.max(1, Math.floor(initialWidth * pixelRatio));
  let currentRenderHeight = Math.max(1, Math.floor(initialHeight * pixelRatio));
  const reflWidth = Math.max(1, Math.floor(currentRenderWidth * reflectionScale));
  const reflHeight = Math.max(1, Math.floor(currentRenderHeight * reflectionScale));

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
  const textures = createWaterfallTextureBundle({ renderer, isSoftwareGpu, isMobileGpu });
  const maxAnisotropy = isSoftwareGpu
    ? 2
    : isMobileGpu
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy())
      : Math.min(16, renderer.capabilities.getMaxAnisotropy());

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
    isMobileGpu,
    preset: initialPreset,
  });

  let activeBiome: ActiveBiomeInstances | null = null;
  let activePreset: WaterfallPresetConfig = initialPreset;
  let shadowRefreshNeeded = true;
  let shadowUniformsDirty = true;
  let reflectionDirty = true;
  let frameIndex = 0;
  let isTabHidden = document.visibilityState === 'hidden';
  let loadGeneration = 0;

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
    if (activeBiome) {
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
    }
    blitPass.setTexture(opaqueTarget.texture);
  };

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

  const setVegetationVisible = (biome: ActiveBiomeInstances, visible: boolean) => {
    if (biome.foliage) {
      biome.foliage.mesh.visible = visible;
    }
    if (biome.forestVegetation) {
      biome.forestVegetation.group.visible = visible;
    }
  };

  const renderFrame = (input: {
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
    readonly forceReflection: boolean;
  }) => {
    const biome = activeBiome;
    if (!biome) {
      return;
    }

    cameraController.update({
      elapsedSeconds: input.elapsedSeconds,
      deltaSeconds: input.deltaSeconds,
    });
    biome.sky.update(input.elapsedSeconds);
    biome.lighting.update(input.elapsedSeconds);
    biome.cliff.update(input.elapsedSeconds);
    biome.foliage?.update(input.elapsedSeconds);
    biome.forestVegetation?.update(input.elapsedSeconds);
    waterPool.update(input.elapsedSeconds);
    biome.waterfall.update(input.elapsedSeconds);
    biome.particles.update(input.elapsedSeconds);

    if (shadowRefreshNeeded) {
      waterPool.mesh.visible = false;
      biome.waterfall.group.visible = false;
      biome.particles.group.visible = false;
      if (biome.foliage) {
        biome.foliage.mesh.visible = false;
      }
      if (biome.forestVegetation) {
        biome.forestVegetation.group.visible = true;
      }
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(opaqueTarget);
      renderer.render(scene, camera);
      shadowRefreshNeeded = false;
      shadowUniformsDirty = true;
    }

    const activeShadowTex = biome.lighting.sunLight.shadow.map?.texture ?? fallbackTexture;
    if (shadowUniformsDirty) {
      const shadowConfig = {
        shadowMap: activeShadowTex,
        shadowMatrix: biome.lighting.sunLight.shadow.matrix,
        shadowMapSize: biome.lighting.shadowMapSize,
      };
      biome.foliage?.setShadowUniforms(shadowConfig);
      biome.forestVegetation?.setShadowUniforms(shadowConfig);
      waterPool.setShadowUniforms(shadowConfig);
      biome.waterfall.setShadowUniforms(shadowConfig);
      biome.particles.setShadowUniforms(shadowConfig);
      shadowUniformsDirty = false;
    }

    const shouldUpdateReflection =
      input.forceReflection || reflectionDirty || !isMobileGpu || frameIndex % 2 === 0;
    if (shouldUpdateReflection) {
      updateMirroredReflectionCamera();
      waterPool.mesh.visible = false;
      biome.particles.group.visible = false;
      if (biome.foliage) {
        biome.foliage.mesh.visible = false;
      }
      if (biome.forestVegetation) {
        biome.forestVegetation.group.visible = true;
      }
      biome.waterfall.group.visible = true;
      biome.waterfall.setUseDepthPass(false);
      renderer.clippingPlanes = waterReflectionClipPlanes;
      renderer.setRenderTarget(reflectionTarget);
      renderer.clear();
      renderer.render(scene, reflectionCamera);
      renderer.clippingPlanes = noClipPlanes;
      biome.waterfall.setUseDepthPass(true);
      reflectionDirty = false;
    }

    biome.waterfall.group.visible = false;
    waterPool.mesh.visible = false;
    biome.particles.group.visible = false;
    setVegetationVisible(biome, true);
    renderer.setRenderTarget(opaqueTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(compositeTarget);
    renderer.clear();
    renderer.render(blitPass.scene, blitPass.camera);

    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    biome.sky.mesh.visible = false;
    biome.cliff.group.visible = false;
    setVegetationVisible(biome, false);
    waterPool.mesh.visible = true;
    biome.waterfall.group.visible = true;
    biome.particles.group.visible = true;
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;

    biome.sky.mesh.visible = true;
    biome.cliff.group.visible = true;
    setVegetationVisible(biome, true);

    postProcessing.render({
      elapsedSeconds: input.elapsedSeconds,
      sourceColorTexture: compositeTarget.texture,
      sceneDepthTexture: opaqueTarget.depthTexture ?? fallbackTexture,
      camera,
      shadowMap: activeShadowTex,
      shadowMatrix: biome.lighting.sunLight.shadow.matrix,
      shadowMapSize: biome.lighting.shadowMapSize,
    });
    frameIndex++;
  };

  const loadBiomeAsync = async (presetId: WaterfallPresetId): Promise<WaterfallPresetConfig> => {
    const generation = ++loadGeneration;
    const preset = WATERFALL_PRESETS[presetId];
    activePreset = preset;

    const alreadyCached = textures.isBiomeCached(presetId);
    const textureTotal = alreadyCached ? 1 : presetId === 'forest' ? 16 : 7;
    const modelTotal = presetId === 'forest' ? 4 : 3;
    const totalSteps = textureTotal + modelTotal + 2;
    let completedSteps = 0;

    const reportProgress = (status: string, visible: boolean) => {
      if (disposed || generation !== loadGeneration) {
        return;
      }
      const pct = visible ? Math.min(98, Math.max(8, (completedSteps / totalSteps) * 100)) : 100;
      onLoadProgress?.({
        visible,
        eyebrow: preset.eyebrow,
        title: preset.title,
        progress: pct,
        status,
      });
    };

    reportProgress('Loading terrain & rock textures...', true);
    await waitForAnimationFrame();

    let icelandSets: IcelandTextureSets | null = null;
    let forestSets: ForestTextureSets | null = null;

    if (presetId === 'forest') {
      forestSets = await textures.ensureForestTextures((label) => {
        if (!alreadyCached) {
          completedSteps++;
          reportProgress(`${label}...`, true);
        }
      });
    } else {
      icelandSets = await textures.ensureIcelandTextures((label) => {
        if (!alreadyCached) {
          completedSteps++;
          reportProgress(`${label}...`, true);
        }
      });
    }

    if (alreadyCached) {
      completedSteps = textureTotal;
    }

    if (disposed || generation !== loadGeneration) {
      return preset;
    }

    if (activeBiome) {
      disposeBiome(activeBiome);
      activeBiome = null;
    }

    reportProgress('Building canyon geometry & foliage...', true);
    await waitForAnimationFrame();

    const sky = createIcelandicSky({ renderer, noiseTexture, preset });
    scene.add(sky.mesh);
    scene.environment = sky.environmentTexture;

    const lighting = createIcelandicLighting({
      scene,
      isSoftwareGpu,
      isMobileGpu,
      preset,
    });
    scene.add(lighting.group);

    const cliff = createIcelandicCliff({
      noiseTexture,
      icelandTextures: icelandSets,
      forestTextures: forestSets,
      anisotropy: maxAnisotropy,
      presetId,
      onStaticGeometryChanged: () => {
        shadowRefreshNeeded = true;
        reflectionDirty = true;
      },
      onAssetLoaded: (label) => {
        completedSteps++;
        reportProgress(`${label}...`, true);
      },
    });
    scene.add(cliff.group);

    let foliage: FoliageSystem | null = null;
    let forestVegetation: ForestVegetationSystem | null = null;
    if (presetId === 'forest' && forestSets) {
      forestVegetation = createForestVegetation({
        preset,
        forestTextures: forestSets,
        anisotropy: maxAnisotropy,
        isSoftwareGpu,
        isMobileGpu,
        fallbackShadowTexture: fallbackTexture,
        onStaticGeometryChanged: () => {
          shadowRefreshNeeded = true;
          reflectionDirty = true;
        },
        onAssetLoaded: (label) => {
          completedSteps++;
          reportProgress(`${label}...`, true);
        },
      });
      scene.add(forestVegetation.group);
    } else {
      foliage = createHighlandFoliage({
        isSoftwareGpu,
        isMobileGpu,
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
      reducedOverdraw: isSoftwareGpu || isMobileGpu,
      preset,
    });
    scene.add(particles.group);

    waterPool.applyPreset(preset);
    postProcessing.applyPreset(preset);

    activeBiome = {
      preset,
      sky,
      lighting,
      cliff,
      foliage,
      forestVegetation,
      waterfall,
      particles,
    };

    syncSceneTargetUniforms({ width: currentRenderWidth, height: currentRenderHeight });
    cameraController.setHeroPose({
      position: preset.heroCameraPosition,
      target: preset.heroCameraTarget,
      immediate: true,
    });

    await Promise.all([cliff.ready, forestVegetation?.ready ?? Promise.resolve()]);
    if (disposed || generation !== loadGeneration) {
      return preset;
    }

    completedSteps++;
    reportProgress('Compiling shaders & shadows...', true);
    await waitForAnimationFrame();

    shadowRefreshNeeded = true;
    shadowUniformsDirty = true;
    reflectionDirty = true;
    clock.getDelta();
    renderFrame({
      elapsedSeconds: clock.elapsedTime,
      deltaSeconds: 0,
      forceReflection: true,
    });

    completedSteps = totalSteps;
    reportProgress('Ready', false);
    return preset;
  };

  const handleResize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    const updatedPixelRatio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
    currentRenderWidth = Math.max(1, Math.floor(width * updatedPixelRatio));
    currentRenderHeight = Math.max(1, Math.floor(height * updatedPixelRatio));
    const nextReflW = Math.max(1, Math.floor(currentRenderWidth * reflectionScale));
    const nextReflH = Math.max(1, Math.floor(currentRenderHeight * reflectionScale));

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
    reflectionDirty = true;
  };

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(animationFrameId);
  };

  const handleContextRestored = () => {
    if (!disposed) {
      shadowRefreshNeeded = true;
      shadowUniformsDirty = true;
      reflectionDirty = true;
      clock.getDelta();
      animationFrameId = requestAnimationFrame(animate);
    }
  };

  const handleVisibilityChange = () => {
    isTabHidden = document.visibilityState === 'hidden';
    if (!isTabHidden && !disposed) {
      clock.getDelta();
      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(animate);
    }
  };

  window.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

  const animate = () => {
    if (disposed || isTabHidden) {
      return;
    }

    animationFrameId = requestAnimationFrame(animate);
    const deltaSeconds = clock.getDelta();
    const elapsedSeconds = clock.elapsedTime;

    renderFrame({
      elapsedSeconds,
      deltaSeconds,
      forceReflection: false,
    });
  };

  void loadBiomeAsync('iceland').then(() => {
    if (!disposed && !isTabHidden) {
      clock.getDelta();
      animationFrameId = requestAnimationFrame(animate);
    }
  });

  return {
    getPreset: () => activePreset,
    switchWaterfall: async () => {
      const nextId = getNextWaterfallPresetId(activePreset.id);
      return loadBiomeAsync(nextId);
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
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      cameraController.dispose();
      postProcessing.dispose();
      blitPass.dispose();
      opaqueTarget.depthTexture?.dispose();
      opaqueTarget.dispose();
      compositeTarget.dispose();
      reflectionTarget.dispose();
      if (activeBiome) {
        disposeBiome(activeBiome);
      }
      waterPool.dispose();
      textures.dispose();
      noiseTexture.dispose();
      fallbackTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
