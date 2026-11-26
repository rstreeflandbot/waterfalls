import * as THREE from 'three';
import {
  MIST_BILLBOARD_FRAGMENT_SHADER,
  MIST_BILLBOARD_VERTEX_SHADER,
  SPRAY_STREAK_FRAGMENT_SHADER,
  SPRAY_STREAK_VERTEX_SHADER,
} from '../shaders/particleShaders';
import { SCENE_CONFIG, createSeededRandom } from './cliffMath';
import { FOREST_WATERFALL_CONFIG } from './forestCanyonMath';
import { WaterfallPresetConfig } from './waterfallPresets';

export interface ParticleSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly setSceneTextures: (options: {
    readonly depthTexture: THREE.Texture;
    readonly width: number;
    readonly height: number;
    readonly cameraNear: number;
    readonly cameraFar: number;
  }) => void;
  readonly setShadowUniforms: (options: {
    readonly shadowMap: THREE.Texture;
    readonly shadowMatrix: THREE.Matrix4;
    readonly shadowMapSize: number;
  }) => void;
  readonly dispose: () => void;
}

interface MistLayerConfig {
  readonly count: number;
  readonly seed: number;
  readonly opacityScale: number;
  readonly minScale: number;
  readonly maxScale: number;
  readonly minDuration: number;
  readonly maxDuration: number;
  readonly spawnSpreadX: number;
  readonly spawnMinY: number;
  readonly spawnMaxY: number;
  readonly spawnCenterZ: number;
  readonly spawnSpreadZ: number;
  readonly driftForwardMin: number;
  readonly driftForwardMax: number;
  readonly driftUpMin: number;
  readonly driftUpMax: number;
  readonly driftSideSpread: number;
  readonly renderOrder: number;
}

interface MistUniforms {
  readonly uTime: { value: number };
  readonly uSunDirection: { value: THREE.Vector3 };
  readonly uOpacityScale: { value: number };
  readonly uNoiseTex: { value: THREE.Texture };
  readonly tSceneDepth: { value: THREE.Texture };
  readonly uResolution: { value: THREE.Vector2 };
  readonly uCameraNear: { value: number };
  readonly uCameraFar: { value: number };
  readonly uSunShadowMap: { value: THREE.Texture };
  readonly uSunShadowMatrix: { value: THREE.Matrix4 };
  readonly uShadowMapSize: { value: number };
  readonly uForestMode: { value: number };
  readonly uFogCool: { value: THREE.Vector3 };
  readonly uFogWarm: { value: THREE.Vector3 };
}

interface StreakUniforms {
  readonly uTime: { value: number };
  readonly uSunDirection: { value: THREE.Vector3 };
  readonly tSceneDepth: { value: THREE.Texture };
  readonly uResolution: { value: THREE.Vector2 };
  readonly uSunShadowMap: { value: THREE.Texture };
  readonly uSunShadowMatrix: { value: THREE.Matrix4 };
  readonly uShadowMapSize: { value: number };
  readonly uForestMode: { value: number };
  readonly uFogCool: { value: THREE.Vector3 };
  readonly uFogWarm: { value: THREE.Vector3 };
}

function createInstancedQuadGeometry(count: number): {
  readonly baseQuad: THREE.PlaneGeometry;
  readonly instanced: THREE.InstancedBufferGeometry;
} {
  const baseQuad = new THREE.PlaneGeometry(1, 1);
  const instanced = new THREE.InstancedBufferGeometry();
  const baseIndex = baseQuad.getIndex();
  if (baseIndex) {
    instanced.setIndex(baseIndex);
  }
  const basePos = baseQuad.getAttribute('position');
  if (basePos) {
    instanced.setAttribute('position', basePos);
  }
  const baseUv = baseQuad.getAttribute('uv');
  if (baseUv) {
    instanced.setAttribute('uv', baseUv);
  }
  instanced.instanceCount = count;
  return { baseQuad, instanced };
}

function createMistLayer(options: {
  readonly config: MistLayerConfig;
  readonly sunDirection: THREE.Vector3;
  readonly noiseTexture: THREE.DataTexture;
  readonly fallbackTexture: THREE.Texture;
  readonly preset: WaterfallPresetConfig;
}): {
  readonly mesh: THREE.Mesh;
  readonly uniforms: MistUniforms;
  readonly dispose: () => void;
} {
  const { config } = options;
  const { baseQuad, instanced } = createInstancedQuadGeometry(config.count);

  const origins = new Float32Array(config.count * 3);
  const params = new Float32Array(config.count * 4);
  const drifts = new Float32Array(config.count * 3);
  const rand = createSeededRandom(config.seed);

  for (let i = 0; i < config.count; i++) {
    const i3 = i * 3;
    const i4 = i * 4;

    const x = (rand() - 0.5) * 2 * config.spawnSpreadX;
    const y = config.spawnMinY + rand() * (config.spawnMaxY - config.spawnMinY);
    const z = config.spawnCenterZ + (rand() - 0.5) * 2 * config.spawnSpreadZ;

    origins[i3] = x;
    origins[i3 + 1] = y;
    origins[i3 + 2] = z;

    params[i4] = config.minDuration + rand() * (config.maxDuration - config.minDuration);
    params[i4 + 1] = config.minScale + rand() * (config.maxScale - config.minScale);
    params[i4 + 2] = (rand() - 0.5) * 0.25;
    params[i4 + 3] = rand();

    const outwardBias = Math.sign(x || rand() - 0.5) * (0.4 + rand() * 0.8);
    drifts[i3] = outwardBias * config.driftSideSpread + (rand() - 0.5) * 2.0;
    drifts[i3 + 1] = config.driftUpMin + rand() * (config.driftUpMax - config.driftUpMin);
    drifts[i3 + 2] =
      config.driftForwardMin + rand() * (config.driftForwardMax - config.driftForwardMin);
  }

  instanced.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  instanced.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  instanced.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drifts, 3));

  const uniforms: MistUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: options.sunDirection },
    uOpacityScale: { value: config.opacityScale },
    uNoiseTex: { value: options.noiseTexture },
    tSceneDepth: { value: options.fallbackTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCameraNear: { value: 0.25 },
    uCameraFar: { value: 520 },
    uSunShadowMap: { value: options.fallbackTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uForestMode: { value: options.preset.id === 'forest' ? 1 : 0 },
    uFogCool: {
      value: new THREE.Vector3(
        options.preset.fogLinearCool[0],
        options.preset.fogLinearCool[1],
        options.preset.fogLinearCool[2],
      ),
    },
    uFogWarm: {
      value: new THREE.Vector3(
        options.preset.fogLinearWarm[0],
        options.preset.fogLinearWarm[1],
        options.preset.fogLinearWarm[2],
      ),
    },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: MIST_BILLBOARD_VERTEX_SHADER,
    fragmentShader: MIST_BILLBOARD_FRAGMENT_SHADER,
    uniforms: { ...uniforms },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(instanced, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = config.renderOrder;

  return {
    mesh,
    uniforms,
    dispose: () => {
      baseQuad.dispose();
      instanced.dispose();
      material.dispose();
    },
  };
}

function createSplashStreaks(options: {
  readonly count: number;
  readonly sunDirection: THREE.Vector3;
  readonly fallbackTexture: THREE.Texture;
  readonly preset: WaterfallPresetConfig;
  readonly plungeCenterZ: number;
  readonly crestZ: number;
  readonly crestHeight: number;
  readonly plungeWidth: number;
}): {
  readonly mesh: THREE.Mesh;
  readonly uniforms: StreakUniforms;
  readonly dispose: () => void;
} {
  const { baseQuad, instanced } = createInstancedQuadGeometry(options.count);
  const rand = createSeededRandom(88421);

  const origins = new Float32Array(options.count * 3);
  const velocities = new Float32Array(options.count * 3);
  const params = new Float32Array(options.count * 3);

  for (let i = 0; i < options.count; i++) {
    const i3 = i * 3;
    const isCurtainShed = i < options.count * 0.35;

    if (isCurtainShed) {
      const heightRatio = rand();
      origins[i3] = (rand() - 0.5) * options.plungeWidth * 0.9;
      origins[i3 + 1] = 2.5 + heightRatio * (options.crestHeight - 4.0);
      origins[i3 + 2] = options.crestZ + 1.5 + (1 - heightRatio) * 3.1 + (rand() - 0.5) * 1.0;

      velocities[i3] = (rand() - 0.5) * 1.9;
      velocities[i3 + 1] = -2.2 - rand() * 3.2;
      velocities[i3 + 2] = 0.7 + rand() * 1.9;

      params[i3] = 1.4 + rand() * 1.4;
      params[i3 + 1] = rand();
      params[i3 + 2] = 0.6 + rand() * 0.9;
    } else {
      const angle = (rand() - 0.5) * Math.PI * 1.15;
      origins[i3] = (rand() - 0.5) * options.plungeWidth * 1.0;
      origins[i3 + 1] = 0.2 + rand() * 0.9;
      origins[i3 + 2] = options.plungeCenterZ + 0.5 + (rand() - 0.5) * 2.4;

      const launchSpeed = 2.8 + rand() * 5.2;
      velocities[i3] = Math.sin(angle) * launchSpeed * 0.85;
      velocities[i3 + 1] = 3.2 + rand() * 5.6;
      velocities[i3 + 2] = Math.cos(angle) * launchSpeed * 0.9 + 0.8;

      params[i3] = 1.2 + rand() * 1.6;
      params[i3 + 1] = rand();
      params[i3 + 2] = 0.75 + rand() * 1.1;
    }
  }

  instanced.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  instanced.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(velocities, 3));
  instanced.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 3));

  const uniforms: StreakUniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: options.sunDirection },
    tSceneDepth: { value: options.fallbackTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSunShadowMap: { value: options.fallbackTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uForestMode: { value: options.preset.id === 'forest' ? 1 : 0 },
    uFogCool: {
      value: new THREE.Vector3(
        options.preset.fogLinearCool[0],
        options.preset.fogLinearCool[1],
        options.preset.fogLinearCool[2],
      ),
    },
    uFogWarm: {
      value: new THREE.Vector3(
        options.preset.fogLinearWarm[0],
        options.preset.fogLinearWarm[1],
        options.preset.fogLinearWarm[2],
      ),
    },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: SPRAY_STREAK_VERTEX_SHADER,
    fragmentShader: SPRAY_STREAK_FRAGMENT_SHADER,
    uniforms: { ...uniforms },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(instanced, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;

  return {
    mesh,
    uniforms,
    dispose: () => {
      baseQuad.dispose();
      instanced.dispose();
      material.dispose();
    },
  };
}

export function createWaterfallParticles(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly fallbackTexture: THREE.Texture;
  readonly reducedOverdraw: boolean;
  readonly preset: WaterfallPresetConfig;
}): ParticleSystem {
  const group = new THREE.Group();
  const isForest = options.preset.id === 'forest';
  const sunDirection = new THREE.Vector3(
    options.preset.sunDirection.x,
    options.preset.sunDirection.y,
    options.preset.sunDirection.z,
  ).normalize();

  const plungeZ = options.preset.waterStyle.plungeCenterZ;

  const plungeBoilMist = createMistLayer({
    sunDirection,
    noiseTexture: options.noiseTexture,
    fallbackTexture: options.fallbackTexture,
    preset: options.preset,
    config: {
      count: options.reducedOverdraw ? 42 : 68,
      seed: 10101,
      opacityScale: isForest ? 0.14 : 0.34,
      minScale: 2.8,
      maxScale: 5.5,
      minDuration: 2.8,
      maxDuration: 5.2,
      spawnSpreadX: isForest ? 4.8 : 6.2,
      spawnMinY: 0.1,
      spawnMaxY: 1.5,
      spawnCenterZ: plungeZ + 0.9,
      spawnSpreadZ: 1.8,
      driftForwardMin: 1.8,
      driftForwardMax: 6.0,
      driftUpMin: 2.5,
      driftUpMax: 6.6,
      driftSideSpread: 3.8,
      renderOrder: 6,
    },
  });

  const risingVaporPlumes = createMistLayer({
    sunDirection,
    noiseTexture: options.noiseTexture,
    fallbackTexture: options.fallbackTexture,
    preset: options.preset,
    config: {
      count: options.reducedOverdraw ? 28 : 48,
      seed: 20202,
      opacityScale: isForest ? 0.09 : 0.16,
      minScale: 6.2,
      maxScale: 11.6,
      minDuration: 6.8,
      maxDuration: 11.8,
      spawnSpreadX: 8.6,
      spawnMinY: 0.8,
      spawnMaxY: 4.2,
      spawnCenterZ: plungeZ + 2.8,
      spawnSpreadZ: 3.0,
      driftForwardMin: 3.8,
      driftForwardMax: 10.5,
      driftUpMin: 3.4,
      driftUpMax: 9.2,
      driftSideSpread: 6.8,
      renderOrder: 7,
    },
  });

  const mistLayers = [plungeBoilMist, risingVaporPlumes];

  if (isForest) {
    const midShelfMist = createMistLayer({
      sunDirection,
      noiseTexture: options.noiseTexture,
      fallbackTexture: options.fallbackTexture,
      preset: options.preset,
      config: {
        count: options.reducedOverdraw ? 24 : 42,
        seed: 30303,
        opacityScale: 0.15,
        minScale: 2.6,
        maxScale: 5.4,
        minDuration: 2.8,
        maxDuration: 5.4,
        spawnSpreadX: 3.4,
        spawnMinY: FOREST_WATERFALL_CONFIG.midShelfHeight - 0.2,
        spawnMaxY: FOREST_WATERFALL_CONFIG.midShelfHeight + 2.4,
        spawnCenterZ: FOREST_WATERFALL_CONFIG.midShelfZ - 0.8,
        spawnSpreadZ: 1.6,
        driftForwardMin: 1.4,
        driftForwardMax: 4.6,
        driftUpMin: 1.8,
        driftUpMax: 5.2,
        driftSideSpread: 2.6,
        renderOrder: 6,
      },
    });
    mistLayers.push(midShelfMist);
  }

  for (const layer of mistLayers) {
    group.add(layer.mesh);
  }

  const streaks = createSplashStreaks({
    count: options.reducedOverdraw ? 650 : 1200,
    sunDirection,
    fallbackTexture: options.fallbackTexture,
    preset: options.preset,
    plungeCenterZ: plungeZ,
    crestZ: isForest ? FOREST_WATERFALL_CONFIG.midShelfZ : SCENE_CONFIG.crestZ,
    crestHeight: isForest ? FOREST_WATERFALL_CONFIG.upperCrestHeight : SCENE_CONFIG.crestHeight,
    plungeWidth: isForest ? FOREST_WATERFALL_CONFIG.lowerWidthBottom : SCENE_CONFIG.plungeWidth,
  });
  group.add(streaks.mesh);

  return {
    group,
    update: (elapsedSeconds: number) => {
      for (const layer of mistLayers) {
        layer.uniforms.uTime.value = elapsedSeconds;
      }
      streaks.uniforms.uTime.value = elapsedSeconds;
    },
    setSceneTextures: (sceneOpts) => {
      for (const layer of mistLayers) {
        layer.uniforms.tSceneDepth.value = sceneOpts.depthTexture;
        layer.uniforms.uResolution.value.set(sceneOpts.width, sceneOpts.height);
        layer.uniforms.uCameraNear.value = sceneOpts.cameraNear;
        layer.uniforms.uCameraFar.value = sceneOpts.cameraFar;
      }
      streaks.uniforms.tSceneDepth.value = sceneOpts.depthTexture;
      streaks.uniforms.uResolution.value.set(sceneOpts.width, sceneOpts.height);
    },
    setShadowUniforms: (shadowOpts) => {
      for (const layer of mistLayers) {
        layer.uniforms.uSunShadowMap.value = shadowOpts.shadowMap;
        layer.uniforms.uSunShadowMatrix.value.copy(shadowOpts.shadowMatrix);
        layer.uniforms.uShadowMapSize.value = shadowOpts.shadowMapSize;
      }
      streaks.uniforms.uSunShadowMap.value = shadowOpts.shadowMap;
      streaks.uniforms.uSunShadowMatrix.value.copy(shadowOpts.shadowMatrix);
      streaks.uniforms.uShadowMapSize.value = shadowOpts.shadowMapSize;
    },
    dispose: () => {
      for (const layer of mistLayers) {
        layer.dispose();
      }
      streaks.dispose();
    },
  };
}
