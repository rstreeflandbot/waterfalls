import * as THREE from 'three';
import {
  WATERFALL_CURTAIN_FRAGMENT_SHADER,
  WATERFALL_CURTAIN_VERTEX_SHADER,
} from '../shaders/waterfallShaders';
import {
  SCENE_CONFIG,
  clamp,
  computeEscarpmentLineZ,
  computeParabolicFallPoint,
  computeWaterfallCrestHeight,
} from './cliffMath';
import { IcelandWaterfallConfig } from './icelandConfig';

export interface WaterfallSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly setSceneTextures: (options: {
    readonly colorTexture: THREE.Texture;
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
  readonly setUseDepthPass: (enabled: boolean) => void;
  readonly dispose: () => void;
}

interface MainWaterfallLobe {
  readonly centerU: number;
  readonly widthU: number;
  readonly forwardBoost: number;
  readonly thicknessWeight: number;
}

const ASYMMETRIC_CHUTE_LOBES: readonly MainWaterfallLobe[] = [
  { centerU: 0.11, widthU: 0.08, forwardBoost: 0.45, thicknessWeight: 0.55 },
  { centerU: 0.23, widthU: 0.11, forwardBoost: 1.25, thicknessWeight: 0.92 },
  { centerU: 0.38, widthU: 0.14, forwardBoost: 1.55, thicknessWeight: 1.05 },
  { centerU: 0.49, widthU: 0.08, forwardBoost: 0.62, thicknessWeight: 0.48 },
  { centerU: 0.62, widthU: 0.15, forwardBoost: 1.32, thicknessWeight: 0.96 },
  { centerU: 0.77, widthU: 0.09, forwardBoost: 0.88, thicknessWeight: 0.74 },
  { centerU: 0.89, widthU: 0.08, forwardBoost: 0.36, thicknessWeight: 0.46 },
];

function evaluateAsymmetricChuteProfile(u: number): {
  readonly forwardBoost: number;
  readonly chuteIntensity: number;
} {
  let forwardBoost = 0;
  let chuteIntensity = 0.14;

  for (const lobe of ASYMMETRIC_CHUTE_LOBES) {
    const dist = (u - lobe.centerU) / lobe.widthU;
    const bell = Math.exp(-dist * dist * 1.85);
    forwardBoost += bell * lobe.forwardBoost;
    chuteIntensity += bell * lobe.thicknessWeight;
  }

  const microJag = Math.sin(u * 29.0 + 1.1) * 0.16 + Math.cos(u * 47.0 - 0.6) * 0.09;
  return {
    forwardBoost: Math.max(0, forwardBoost + microJag),
    chuteIntensity: clamp({ value: chuteIntensity, min: 0.14, max: 1.0 }),
  };
}

function createIcelandMainWaterfallGeometry(): THREE.BufferGeometry {
  const widthSegments = 112;
  const heightSegments = 96;
  const geometry = new THREE.PlaneGeometry(1, 1, widthSegments, heightSegments);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  const chuteMasks = new Float32Array(posAttr.count);
  const lipTransition = 0.15;

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const progress = 1 - v;
    const centeredU = (u - 0.5) * 2;
    const profile = evaluateAsymmetricChuteProfile(u);

    const asymmetricFlare =
      SCENE_CONFIG.crestWidth +
      (SCENE_CONFIG.plungeWidth - SCENE_CONFIG.crestWidth) * Math.pow(progress, 0.82) +
      Math.sin(progress * Math.PI * 1.4 + centeredU * 1.8) * 0.55 * progress;
    const x = centeredU * (asymmetricFlare * 0.5) + Math.sin(progress * 3.1) * 0.28 * progress;

    const cliffLipZ = computeEscarpmentLineZ(x);
    const crestY = computeWaterfallCrestHeight(x);
    const sideWrapBack = Math.pow(Math.abs(centeredU), 2.35) * 2.15;

    let y: number;
    let z: number;

    if (progress < lipTransition) {
      const lipT = progress / lipTransition;
      const curvedDrop = Math.pow(lipT, 2.3) * 1.05;
      y = crestY + 0.08 - curvedDrop;
      z = cliffLipZ - 4.6 + lipT * 5.25 + (profile.forwardBoost * 0.25 - sideWrapBack * 0.4) * lipT;
    } else {
      const fallT = (progress - lipTransition) / (1 - lipTransition);
      const startY = crestY - 0.97;
      const baseReach = 2.65 + profile.forwardBoost * 0.92;
      const point = computeParabolicFallPoint({
        progress: fallT,
        startY,
        endY: -0.65,
        startZ: cliffLipZ + 0.65,
        forwardReach: baseReach,
      });

      const leftShelfBounce =
        Math.exp(-Math.pow((x + 3.6) / 1.9, 2)) *
        Math.exp(-Math.pow((fallT - 0.54) / 0.24, 2)) *
        1.55;
      const rightLedgeKick =
        Math.exp(-Math.pow((x - 3.9) / 1.6, 2)) *
        Math.exp(-Math.pow((fallT - 0.66) / 0.22, 2)) *
        1.15;

      const organicFlutter =
        Math.sin(x * 1.15 + fallT * 5.2) * 0.24 * fallT +
        Math.cos(x * 2.3 - fallT * 3.8) * 0.14 * fallT;

      y = point.y + leftShelfBounce * 0.18;
      z = point.z + leftShelfBounce + rightLedgeKick + organicFlutter - sideWrapBack;
    }

    posAttr.setXYZ(i, x, y, z);
    chuteMasks[i] = profile.chuteIntensity * (1 - Math.pow(Math.abs(centeredU), 3.2) * 0.65);
  }

  geometry.setAttribute('aChuteMask', new THREE.BufferAttribute(chuteMasks, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createVolumetricPlumeVeilGeometry(options: {
  readonly centerX: number;
  readonly widthTop: number;
  readonly widthBottom: number;
  readonly startY: number;
  readonly endY: number;
  readonly startZ: number;
  readonly forwardReach: number;
  readonly archDepth: number;
  readonly phase: number;
}): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 28, 56);
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

    const width =
      options.widthTop + (options.widthBottom - options.widthTop) * Math.pow(progress, 0.82);
    const x =
      options.centerX +
      centeredU * (width * 0.5) +
      Math.sin(progress * 4.2 + options.phase) * 0.26 * progress;

    const point = computeParabolicFallPoint({
      progress,
      startY: options.startY,
      endY: options.endY,
      startZ: options.startZ,
      forwardReach: options.forwardReach,
    });

    const halfTubeCurve = Math.cos(centeredU * Math.PI * 0.5) * options.archDepth;
    const edgeTuckBack = -Math.pow(Math.abs(centeredU), 2.0) * 1.15;
    const ripple = Math.sin(progress * Math.PI * 3.4 + options.phase) * 0.18 * progress;

    posAttr.setXYZ(i, x, point.y, point.z + halfTubeCurve + edgeTuckBack + ripple);
    chuteMasks[i] = Math.cos(centeredU * Math.PI * 0.5);
  }

  geometry.setAttribute('aChuteMask', new THREE.BufferAttribute(chuteMasks, 1));
  geometry.computeVertexNormals();
  return geometry;
}

interface WaterfallMaterialUniforms {
  readonly uTime: { value: number };
  readonly uOpacity: { value: number };
  readonly uSpeed: { value: number };
  readonly uTurbulence: { value: number };
  readonly uPhaseOffset: { value: number };
  readonly uCoreDensity: { value: number };
  readonly uHorizontalRepeat: { value: number };
  readonly uSunDirection: { value: THREE.Vector3 };
  readonly uNoiseTex: { value: THREE.Texture };
  readonly uFoamTex: { value: THREE.Texture };
  readonly tSceneColor: { value: THREE.Texture };
  readonly tSceneDepth: { value: THREE.Texture };
  readonly uResolution: { value: THREE.Vector2 };
  readonly uCameraNear: { value: number };
  readonly uCameraFar: { value: number };
  readonly uUseDepthPass: { value: number };
  readonly uSunShadowMap: { value: THREE.Texture };
  readonly uSunShadowMatrix: { value: THREE.Matrix4 };
  readonly uShadowMapSize: { value: number };
}

export function createIcelandicWaterfall(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly foamTexture: THREE.DataTexture;
  readonly fallbackTexture: THREE.Texture;
  readonly config: IcelandWaterfallConfig;
}): WaterfallSystem {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(
    options.config.sunDirection.x,
    options.config.sunDirection.y,
    options.config.sunDirection.z,
  ).normalize();

  const materialUniforms: WaterfallMaterialUniforms[] = [];
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];

  const createWaterfallMat = (cfg: {
    readonly opacity: number;
    readonly speed: number;
    readonly turbulence: number;
    readonly phaseOffset: number;
    readonly coreDensity: number;
    readonly horizontalRepeat: number;
  }): THREE.ShaderMaterial => {
    const uniforms: WaterfallMaterialUniforms = {
      uTime: { value: 0 },
      uOpacity: { value: cfg.opacity },
      uSpeed: { value: cfg.speed },
      uTurbulence: { value: cfg.turbulence },
      uPhaseOffset: { value: cfg.phaseOffset },
      uCoreDensity: { value: cfg.coreDensity },
      uHorizontalRepeat: { value: cfg.horizontalRepeat },
      uSunDirection: { value: sunDir },
      uNoiseTex: { value: options.noiseTexture },
      uFoamTex: { value: options.foamTexture },
      tSceneColor: { value: options.fallbackTexture },
      tSceneDepth: { value: options.fallbackTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCameraNear: { value: 0.25 },
      uCameraFar: { value: 520 },
      uUseDepthPass: { value: 1 },
      uSunShadowMap: { value: options.fallbackTexture },
      uSunShadowMatrix: { value: new THREE.Matrix4() },
      uShadowMapSize: { value: 1024 },
    };
    materialUniforms.push(uniforms);

    const mat = new THREE.ShaderMaterial({
      vertexShader: WATERFALL_CURTAIN_VERTEX_SHADER,
      fragmentShader: WATERFALL_CURTAIN_FRAGMENT_SHADER,
      uniforms: { ...uniforms },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(mat);
    return mat;
  };

  const mainGeometry = createIcelandMainWaterfallGeometry();
  geometriesToDispose.push(mainGeometry);
  const mainMaterial = createWaterfallMat({
    opacity: 0.96,
    speed: 1.5,
    turbulence: 1.05,
    phaseOffset: 0.0,
    coreDensity: 0.78,
    horizontalRepeat: 2.75,
  });
  const mainMesh = new THREE.Mesh(mainGeometry, mainMaterial);
  mainMesh.renderOrder = 3;
  group.add(mainMesh);

  const outerPlumeConfigs = [
    {
      centerX: -3.5,
      widthTop: 2.1,
      widthBottom: 3.4,
      startY: computeWaterfallCrestHeight(-3.5) - 1.6,
      endY: -0.45,
      startZ: computeEscarpmentLineZ(-3.5) + 0.85,
      forwardReach: 4.5,
      archDepth: 0.78,
      phase: 1.4,
      speed: 1.66,
      opacity: 0.56,
    },
    {
      centerX: -1.1,
      widthTop: 3.4,
      widthBottom: 4.8,
      startY: computeWaterfallCrestHeight(-1.1) - 0.9,
      endY: -0.45,
      startZ: computeEscarpmentLineZ(-1.1) + 0.85,
      forwardReach: 4.9,
      archDepth: 1.05,
      phase: 3.9,
      speed: 1.88,
      opacity: 0.58,
    },
    {
      centerX: 1.9,
      widthTop: 2.6,
      widthBottom: 3.7,
      startY: computeWaterfallCrestHeight(1.9) - 1.15,
      endY: -0.45,
      startZ: computeEscarpmentLineZ(1.9) + 0.85,
      forwardReach: 4.2,
      archDepth: 0.88,
      phase: 6.7,
      speed: 1.72,
      opacity: 0.52,
    },
    {
      centerX: 4.1,
      widthTop: 1.8,
      widthBottom: 2.9,
      startY: computeWaterfallCrestHeight(4.1) - 2.1,
      endY: -0.45,
      startZ: computeEscarpmentLineZ(4.1) + 0.85,
      forwardReach: 3.6,
      archDepth: 0.64,
      phase: 9.3,
      speed: 1.54,
      opacity: 0.46,
    },
  ];

  for (const cfg of outerPlumeConfigs) {
    const plumeGeo = createVolumetricPlumeVeilGeometry(cfg);
    geometriesToDispose.push(plumeGeo);
    const plumeMat = createWaterfallMat({
      opacity: cfg.opacity,
      speed: cfg.speed,
      turbulence: 1.18,
      phaseOffset: cfg.phase,
      coreDensity: 0.14,
      horizontalRepeat: 1.45,
    });
    const mesh = new THREE.Mesh(plumeGeo, plumeMat);
    mesh.renderOrder = 4;
    group.add(mesh);
  }

  return {
    group,
    update: (elapsedSeconds: number) => {
      for (const u of materialUniforms) {
        u.uTime.value = elapsedSeconds;
      }
    },
    setSceneTextures: (sceneOpts) => {
      for (const u of materialUniforms) {
        u.tSceneColor.value = sceneOpts.colorTexture;
        u.tSceneDepth.value = sceneOpts.depthTexture;
        u.uResolution.value.set(sceneOpts.width, sceneOpts.height);
        u.uCameraNear.value = sceneOpts.cameraNear;
        u.uCameraFar.value = sceneOpts.cameraFar;
      }
    },
    setShadowUniforms: (shadowOpts) => {
      for (const u of materialUniforms) {
        u.uSunShadowMap.value = shadowOpts.shadowMap;
        u.uSunShadowMatrix.value.copy(shadowOpts.shadowMatrix);
        u.uShadowMapSize.value = shadowOpts.shadowMapSize;
      }
    },
    setUseDepthPass: (enabled: boolean) => {
      const flag = enabled ? 1 : 0;
      for (const u of materialUniforms) {
        u.uUseDepthPass.value = flag;
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
