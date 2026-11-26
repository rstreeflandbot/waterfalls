import * as THREE from 'three';
import {
  PLUNGE_BOIL_FRAGMENT_SHADER,
  PLUNGE_BOIL_VERTEX_SHADER,
  WATERFALL_CURTAIN_FRAGMENT_SHADER,
  WATERFALL_CURTAIN_VERTEX_SHADER,
} from '../shaders/waterfallShaders';
import {
  SCENE_CONFIG,
  clamp,
  computeOpenVolcanicTerrainHeight,
  computeParabolicFallPoint,
  smoothstep,
} from './cliffMath';

export interface WaterfallSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

interface MainWaterfallLobe {
  readonly centerU: number;
  readonly widthU: number;
  readonly forwardBoost: number;
  readonly crestOffset: number;
}

const MAIN_CHUTE_LOBES: readonly MainWaterfallLobe[] = [
  { centerU: 0.14, widthU: 0.12, forwardBoost: 0.48, crestOffset: -0.35 },
  { centerU: 0.28, widthU: 0.14, forwardBoost: 0.85, crestOffset: -0.1 },
  { centerU: 0.43, widthU: 0.16, forwardBoost: 1.05, crestOffset: 0.05 },
  { centerU: 0.56, widthU: 0.15, forwardBoost: 0.92, crestOffset: 0.0 },
  { centerU: 0.71, widthU: 0.14, forwardBoost: 0.78, crestOffset: -0.15 },
  { centerU: 0.85, widthU: 0.12, forwardBoost: 0.45, crestOffset: -0.4 },
];

function evaluateChuteProfile(u: number): {
  readonly forwardBoost: number;
  readonly crestOffset: number;
  readonly chuteIntensity: number;
} {
  let forwardBoost = 0;
  let crestOffset = 0;
  let chuteIntensity = 0.22;

  for (const lobe of MAIN_CHUTE_LOBES) {
    const dist = (u - lobe.centerU) / lobe.widthU;
    const bell = Math.exp(-dist * dist * 1.6);
    forwardBoost += bell * lobe.forwardBoost;
    crestOffset += bell * lobe.crestOffset;
    chuteIntensity += bell * 0.85;
  }

  return {
    forwardBoost,
    crestOffset,
    chuteIntensity: clamp({ value: chuteIntensity, min: 0.2, max: 1.0 }),
  };
}

function createSculptedMainWaterfallGeometry(): THREE.BufferGeometry {
  const widthSegments = 96;
  const heightSegments = 88;
  const geometry = new THREE.PlaneGeometry(1, 1, widthSegments, heightSegments);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  const chuteMasks = new Float32Array(posAttr.count);
  const lipTransition = 0.13;

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const progress = 1 - v;
    const centeredU = (u - 0.5) * 2;
    const profile = evaluateChuteProfile(u);

    const widthAtProgress =
      SCENE_CONFIG.crestWidth +
      (SCENE_CONFIG.plungeWidth - SCENE_CONFIG.crestWidth) * Math.pow(progress, 0.82);
    const x = centeredU * (widthAtProgress * 0.5);

    const sideWrapBack = Math.pow(Math.abs(centeredU), 2.8) * 2.35;
    const mainArch = (1 - centeredU * centeredU) * 0.65;

    let y: number;
    let z: number;

    if (progress < lipTransition) {
      const lipT = progress / lipTransition;
      const curvedDrop = Math.pow(lipT, 2.2) * 1.15;
      y = SCENE_CONFIG.crestHeight + 0.2 + profile.crestOffset * 0.5 - curvedDrop;
      z =
        SCENE_CONFIG.crestZ -
        5.4 +
        lipT * 5.65 +
        (profile.forwardBoost * 0.35 + mainArch * 0.4 - sideWrapBack * 0.45) * lipT;
    } else {
      const fallT = (progress - lipTransition) / (1 - lipTransition);
      const startY = SCENE_CONFIG.crestHeight - 0.95 + profile.crestOffset * 0.5;
      const point = computeParabolicFallPoint({
        progress: fallT,
        startY,
        endY: -0.45,
        startZ: SCENE_CONFIG.crestZ + 0.25,
        forwardReach: 3.55 + profile.forwardBoost * 0.62,
      });

      const fluteDepth = profile.forwardBoost * (0.42 + 0.58 * Math.sin(fallT * Math.PI * 0.85));
      y = point.y;
      z = point.z + mainArch + fluteDepth - sideWrapBack;
    }

    posAttr.setXYZ(i, x, y, z);
    chuteMasks[i] = profile.chuteIntensity * (1 - Math.pow(Math.abs(centeredU), 4.0) * 0.55);
  }

  geometry.setAttribute('aChuteMask', new THREE.BufferAttribute(chuteMasks, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createVolumetricPlumeVeilGeometry(options: {
  readonly centerU: number;
  readonly widthTop: number;
  readonly widthBottom: number;
  readonly startY: number;
  readonly forwardReach: number;
  readonly archDepth: number;
  readonly phase: number;
}): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 24, 52);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  const chuteMasks = new Float32Array(posAttr.count);
  const centerX = (options.centerU - 0.5) * SCENE_CONFIG.crestWidth;

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const progress = 1 - v;
    const centeredU = (u - 0.5) * 2;

    const width =
      options.widthTop + (options.widthBottom - options.widthTop) * Math.pow(progress, 0.85);
    const x = centerX + centeredU * (width * 0.5);

    const point = computeParabolicFallPoint({
      progress,
      startY: options.startY,
      endY: -0.3,
      startZ: SCENE_CONFIG.crestZ + 0.45,
      forwardReach: options.forwardReach,
    });

    const halfTubeCurve = Math.cos(centeredU * Math.PI * 0.5) * options.archDepth;
    const edgeTuckBack = -Math.pow(Math.abs(centeredU), 2.2) * 0.95;
    const ripple = Math.sin(progress * Math.PI * 3.0 + options.phase) * 0.14 * progress;

    posAttr.setXYZ(i, x, point.y, point.z + halfTubeCurve + edgeTuckBack + ripple);
    chuteMasks[i] = Math.cos(centeredU * Math.PI * 0.5);
  }

  geometry.setAttribute('aChuteMask', new THREE.BufferAttribute(chuteMasks, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createCliffHuggingCascadeGeometry(options: {
  readonly centerX: number;
  readonly widthTop: number;
  readonly widthBottom: number;
  readonly startY: number;
}): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 16, 40);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  const chuteMasks = new Float32Array(posAttr.count);

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const progress = 1 - v;
    const centeredU = (u - 0.5) * 2;

    const width = options.widthTop + (options.widthBottom - options.widthTop) * progress;
    const x = options.centerX + centeredU * (width * 0.5);
    const targetY = options.startY * (1 - progress * progress);

    let bestZ = SCENE_CONFIG.crestZ + 1.5;
    let bestDiff = 999;
    for (
      let probeZ = SCENE_CONFIG.crestZ - 2.5;
      probeZ <= SCENE_CONFIG.plungeCenterZ + 3.5;
      probeZ += 0.35
    ) {
      const terrainY = computeOpenVolcanicTerrainHeight({ x: options.centerX, z: probeZ });
      const diff = Math.abs(terrainY - targetY);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestZ = probeZ;
      }
    }

    const curveRound = Math.cos(centeredU * Math.PI * 0.5) * 0.22;
    const edgeTuck = -Math.pow(Math.abs(centeredU), 2.0) * 0.35;
    posAttr.setXYZ(i, x, Math.max(-0.25, targetY), bestZ + 0.25 + curveRound + edgeTuck);
    chuteMasks[i] =
      Math.cos(centeredU * Math.PI * 0.5) * smoothstep({ edge0: 0, edge1: 0.2, value: progress });
  }

  geometry.setAttribute('aChuteMask', new THREE.BufferAttribute(chuteMasks, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export function createIcelandicWaterfall(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly foamTexture: THREE.DataTexture;
}): WaterfallSystem {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
  ).normalize();

  const timeUniforms: Array<{ value: number }> = [];
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];

  const mainGeometry = createSculptedMainWaterfallGeometry();
  geometriesToDispose.push(mainGeometry);
  const mainTime = { value: 0 };
  timeUniforms.push(mainTime);
  const mainMaterial = new THREE.ShaderMaterial({
    vertexShader: WATERFALL_CURTAIN_VERTEX_SHADER,
    fragmentShader: WATERFALL_CURTAIN_FRAGMENT_SHADER,
    uniforms: {
      uTime: mainTime,
      uOpacity: { value: 0.96 },
      uSpeed: { value: 1.55 },
      uTurbulence: { value: 0.85 },
      uPhaseOffset: { value: 0.0 },
      uCoreDensity: { value: 0.84 },
      uHorizontalRepeat: { value: 2.3 },
      uSunDirection: { value: sunDir },
      uNoiseTex: { value: options.noiseTexture },
      uFoamTex: { value: options.foamTexture },
    },
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  materialsToDispose.push(mainMaterial);
  const mainMesh = new THREE.Mesh(mainGeometry, mainMaterial);
  mainMesh.renderOrder = 2;
  group.add(mainMesh);

  const outerPlumeConfigs = [
    {
      centerU: 0.27,
      widthTop: 2.8,
      widthBottom: 3.7,
      startY: SCENE_CONFIG.crestHeight - 1.1,
      forwardReach: 4.35,
      archDepth: 0.85,
      phase: 1.7,
      speed: 1.78,
    },
    {
      centerU: 0.47,
      widthTop: 3.3,
      widthBottom: 4.4,
      startY: SCENE_CONFIG.crestHeight - 0.95,
      forwardReach: 4.65,
      archDepth: 0.95,
      phase: 4.2,
      speed: 1.88,
    },
    {
      centerU: 0.69,
      widthTop: 2.9,
      widthBottom: 3.8,
      startY: SCENE_CONFIG.crestHeight - 1.15,
      forwardReach: 4.4,
      archDepth: 0.82,
      phase: 7.5,
      speed: 1.72,
    },
  ];

  for (const cfg of outerPlumeConfigs) {
    const plumeGeo = createVolumetricPlumeVeilGeometry(cfg);
    geometriesToDispose.push(plumeGeo);
    const uTime = { value: 0 };
    timeUniforms.push(uTime);

    const plumeMat = new THREE.ShaderMaterial({
      vertexShader: WATERFALL_CURTAIN_VERTEX_SHADER,
      fragmentShader: WATERFALL_CURTAIN_FRAGMENT_SHADER,
      uniforms: {
        uTime,
        uOpacity: { value: 0.62 },
        uSpeed: { value: cfg.speed },
        uTurbulence: { value: 1.05 },
        uPhaseOffset: { value: cfg.phase },
        uCoreDensity: { value: 0.24 },
        uHorizontalRepeat: { value: 1.35 },
        uSunDirection: { value: sunDir },
        uNoiseTex: { value: options.noiseTexture },
        uFoamTex: { value: options.foamTexture },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(plumeMat);

    const mesh = new THREE.Mesh(plumeGeo, plumeMat);
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  const sideCascades = [
    {
      centerX: -6.1,
      widthTop: 1.35,
      widthBottom: 1.85,
      startY: SCENE_CONFIG.crestHeight - 4.2,
      phase: 9.8,
    },
    {
      centerX: 6.3,
      widthTop: 1.25,
      widthBottom: 1.75,
      startY: SCENE_CONFIG.crestHeight - 4.8,
      phase: 12.4,
    },
  ];

  for (const cascade of sideCascades) {
    const cascadeGeo = createCliffHuggingCascadeGeometry(cascade);
    geometriesToDispose.push(cascadeGeo);
    const uTime = { value: 0 };
    timeUniforms.push(uTime);

    const cascadeMat = new THREE.ShaderMaterial({
      vertexShader: WATERFALL_CURTAIN_VERTEX_SHADER,
      fragmentShader: WATERFALL_CURTAIN_FRAGMENT_SHADER,
      uniforms: {
        uTime,
        uOpacity: { value: 0.68 },
        uSpeed: { value: 1.25 },
        uTurbulence: { value: 0.35 },
        uPhaseOffset: { value: cascade.phase },
        uCoreDensity: { value: 0.32 },
        uHorizontalRepeat: { value: 0.9 },
        uSunDirection: { value: sunDir },
        uNoiseTex: { value: options.noiseTexture },
        uFoamTex: { value: options.foamTexture },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(cascadeMat);

    const mesh = new THREE.Mesh(cascadeGeo, cascadeMat);
    mesh.renderOrder = 3;
    group.add(mesh);
  }

  const boilGeometry = new THREE.PlaneGeometry(16.0, 8.8, 56, 40);
  boilGeometry.rotateX(-Math.PI / 2);
  geometriesToDispose.push(boilGeometry);

  const boilTime = { value: 0 };
  timeUniforms.push(boilTime);
  const boilMaterial = new THREE.ShaderMaterial({
    vertexShader: PLUNGE_BOIL_VERTEX_SHADER,
    fragmentShader: PLUNGE_BOIL_FRAGMENT_SHADER,
    uniforms: {
      uTime: boilTime,
      uSunDirection: { value: sunDir },
      uNoiseTex: { value: options.noiseTexture },
      uFoamTex: { value: options.foamTexture },
    },
    transparent: true,
    depthWrite: false,
  });
  materialsToDispose.push(boilMaterial);

  const boilMesh = new THREE.Mesh(boilGeometry, boilMaterial);
  boilMesh.position.set(0, SCENE_CONFIG.poolSurfaceY + 0.06, SCENE_CONFIG.plungeCenterZ + 0.85);
  boilMesh.renderOrder = 5;
  group.add(boilMesh);

  return {
    group,
    update: (elapsedSeconds: number) => {
      for (const uniform of timeUniforms) {
        uniform.value = elapsedSeconds;
      }
    },
    dispose: () => {
      for (const geo of geometriesToDispose) {
        geo.dispose();
      }
      for (const mat of materialsToDispose) {
        mat.dispose();
      }
    },
  };
}
