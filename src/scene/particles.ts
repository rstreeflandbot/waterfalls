import * as THREE from 'three';
import {
  MIST_BILLBOARD_FRAGMENT_SHADER,
  MIST_BILLBOARD_VERTEX_SHADER,
  SPRAY_DROPLET_FRAGMENT_SHADER,
  SPRAY_DROPLET_VERTEX_SHADER,
} from '../shaders/particleShaders';
import { SCENE_CONFIG, createSeededRandom } from './cliffMath';

export interface ParticleSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly setPixelRatio: (pixelRatio: number) => void;
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

function createMistLayer(options: {
  readonly config: MistLayerConfig;
  readonly sunDirection: THREE.Vector3;
  readonly noiseTexture: THREE.DataTexture;
}): {
  readonly mesh: THREE.Mesh;
  readonly timeUniform: { value: number };
  readonly dispose: () => void;
} {
  const { config } = options;
  const baseQuad = new THREE.PlaneGeometry(1, 1);
  const instancedGeometry = new THREE.InstancedBufferGeometry();
  const baseIndex = baseQuad.getIndex();
  if (baseIndex) {
    instancedGeometry.setIndex(baseIndex);
  }
  const basePosition = baseQuad.getAttribute('position');
  if (basePosition) {
    instancedGeometry.setAttribute('position', basePosition);
  }
  const baseUv = baseQuad.getAttribute('uv');
  if (baseUv) {
    instancedGeometry.setAttribute('uv', baseUv);
  }
  instancedGeometry.instanceCount = config.count;

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

    const duration = config.minDuration + rand() * (config.maxDuration - config.minDuration);
    const scale = config.minScale + rand() * (config.maxScale - config.minScale);
    const spinSpeed = (rand() - 0.5) * 0.28;
    const seed = rand();

    params[i4] = duration;
    params[i4 + 1] = scale;
    params[i4 + 2] = spinSpeed;
    params[i4 + 3] = seed;

    const outwardBias = Math.sign(x || rand() - 0.5) * (0.4 + rand() * 0.8);
    drifts[i3] = outwardBias * config.driftSideSpread + (rand() - 0.5) * 2.2;
    drifts[i3 + 1] = config.driftUpMin + rand() * (config.driftUpMax - config.driftUpMin);
    drifts[i3 + 2] =
      config.driftForwardMin + rand() * (config.driftForwardMax - config.driftForwardMin);
  }

  instancedGeometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  instancedGeometry.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
  instancedGeometry.setAttribute('aDrift', new THREE.InstancedBufferAttribute(drifts, 3));

  const timeUniform = { value: 0 };
  const material = new THREE.ShaderMaterial({
    vertexShader: MIST_BILLBOARD_VERTEX_SHADER,
    fragmentShader: MIST_BILLBOARD_FRAGMENT_SHADER,
    uniforms: {
      uTime: timeUniform,
      uSunDirection: { value: options.sunDirection },
      uOpacityScale: { value: config.opacityScale },
      uNoiseTex: { value: options.noiseTexture },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });

  const mesh = new THREE.Mesh(instancedGeometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = config.renderOrder;

  return {
    mesh,
    timeUniform,
    dispose: () => {
      baseQuad.dispose();
      instancedGeometry.dispose();
      material.dispose();
    },
  };
}

function createSprayDroplets(options: {
  readonly count: number;
  readonly sunDirection: THREE.Vector3;
  readonly pixelRatio: number;
}): {
  readonly points: THREE.Points;
  readonly timeUniform: { value: number };
  readonly pixelRatioUniform: { value: number };
  readonly dispose: () => void;
} {
  const rand = createSeededRandom(88421);
  const positions = new Float32Array(options.count * 3);
  const velocities = new Float32Array(options.count * 3);
  const params = new Float32Array(options.count * 3);

  for (let i = 0; i < options.count; i++) {
    const i3 = i * 3;
    const isCurtainSpray = i < options.count * 0.3;

    if (isCurtainSpray) {
      const heightRatio = rand();
      positions[i3] = (rand() - 0.5) * SCENE_CONFIG.plungeWidth * 0.92;
      positions[i3 + 1] = 2.0 + heightRatio * (SCENE_CONFIG.crestHeight - 4.0);
      positions[i3 + 2] =
        SCENE_CONFIG.crestZ + 1.4 + (1 - heightRatio) * 3.0 + (rand() - 0.5) * 1.1;

      velocities[i3] = (rand() - 0.5) * 2.2;
      velocities[i3 + 1] = -0.8 - rand() * 2.0;
      velocities[i3 + 2] = 0.8 + rand() * 2.0;

      params[i3] = 1.6 + rand() * 1.6;
      params[i3 + 1] = rand();
      params[i3 + 2] = 0.65 + rand() * 1.0;
    } else {
      const angle = (rand() - 0.5) * Math.PI * 1.15;
      const spreadX = (rand() - 0.5) * SCENE_CONFIG.plungeWidth * 1.05;
      positions[i3] = spreadX;
      positions[i3 + 1] = 0.25 + rand() * 1.2;
      positions[i3 + 2] = SCENE_CONFIG.plungeCenterZ + 0.4 + (rand() - 0.5) * 2.6;

      const launchSpeed = 2.4 + rand() * 5.0;
      velocities[i3] = Math.sin(angle) * launchSpeed * 0.85;
      velocities[i3 + 1] = 2.8 + rand() * 5.2;
      velocities[i3 + 2] = Math.cos(angle) * launchSpeed * 0.92 + 0.8;

      params[i3] = 1.4 + rand() * 1.8;
      params[i3 + 1] = rand();
      params[i3 + 2] = 0.75 + rand() * 1.3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
  geometry.setAttribute('aParams', new THREE.BufferAttribute(params, 3));

  const timeUniform = { value: 0 };
  const pixelRatioUniform = { value: options.pixelRatio };

  const material = new THREE.ShaderMaterial({
    vertexShader: SPRAY_DROPLET_VERTEX_SHADER,
    fragmentShader: SPRAY_DROPLET_FRAGMENT_SHADER,
    uniforms: {
      uTime: timeUniform,
      uPixelRatio: pixelRatioUniform,
      uSunDirection: { value: options.sunDirection },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 8;

  return {
    points,
    timeUniform,
    pixelRatioUniform,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createWaterfallParticles(options: {
  readonly initialPixelRatio: number;
  readonly noiseTexture: THREE.DataTexture;
  readonly reducedOverdraw: boolean;
}): ParticleSystem {
  const group = new THREE.Group();
  const sunDirection = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
  ).normalize();

  const heavyBaseSpray = createMistLayer({
    sunDirection,
    noiseTexture: options.noiseTexture,
    config: {
      count: options.reducedOverdraw ? 42 : 64,
      seed: 10101,
      opacityScale: 0.19,
      minScale: 3.4,
      maxScale: 6.4,
      minDuration: 3.8,
      maxDuration: 6.8,
      spawnSpreadX: 6.4,
      spawnMinY: 0.35,
      spawnMaxY: 1.8,
      spawnCenterZ: SCENE_CONFIG.plungeCenterZ + 1.2,
      spawnSpreadZ: 1.8,
      driftForwardMin: 2.2,
      driftForwardMax: 6.8,
      driftUpMin: 2.8,
      driftUpMax: 7.2,
      driftSideSpread: 4.5,
      renderOrder: 6,
    },
  });

  const risingValleyMist = createMistLayer({
    sunDirection,
    noiseTexture: options.noiseTexture,
    config: {
      count: options.reducedOverdraw ? 26 : 40,
      seed: 20202,
      opacityScale: 0.1,
      minScale: 6.5,
      maxScale: 11.5,
      minDuration: 7.5,
      maxDuration: 13.0,
      spawnSpreadX: 8.5,
      spawnMinY: 1.0,
      spawnMaxY: 4.0,
      spawnCenterZ: SCENE_CONFIG.plungeCenterZ + 3.2,
      spawnSpreadZ: 3.2,
      driftForwardMin: 4.5,
      driftForwardMax: 12.0,
      driftUpMin: 3.2,
      driftUpMax: 9.0,
      driftSideSpread: 7.5,
      renderOrder: 7,
    },
  });

  const droplets = createSprayDroplets({
    count: options.reducedOverdraw ? 900 : 1500,
    sunDirection,
    pixelRatio: options.initialPixelRatio,
  });

  group.add(heavyBaseSpray.mesh);
  group.add(risingValleyMist.mesh);
  group.add(droplets.points);

  return {
    group,
    update: (elapsedSeconds: number) => {
      heavyBaseSpray.timeUniform.value = elapsedSeconds;
      risingValleyMist.timeUniform.value = elapsedSeconds;
      droplets.timeUniform.value = elapsedSeconds;
    },
    setPixelRatio: (pixelRatio: number) => {
      droplets.pixelRatioUniform.value = pixelRatio;
    },
    dispose: () => {
      heavyBaseSpray.dispose();
      risingValleyMist.dispose();
      droplets.dispose();
    },
  };
}
