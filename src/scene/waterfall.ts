import * as THREE from 'three';
import {
  WATERFALL_CURTAIN_FRAGMENT_SHADER,
  WATERFALL_CURTAIN_VERTEX_SHADER,
} from '../shaders/waterfallShaders';
import { SCENE_CONFIG, clamp, computeParabolicFallPoint } from './cliffMath';

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
  readonly crestOffset: number;
}

const MAIN_CHUTE_LOBES: readonly MainWaterfallLobe[] = [
  { centerU: 0.14, widthU: 0.11, forwardBoost: 0.42, crestOffset: -0.4 },
  { centerU: 0.29, widthU: 0.13, forwardBoost: 0.92, crestOffset: -0.1 },
  { centerU: 0.45, widthU: 0.15, forwardBoost: 1.15, crestOffset: 0.08 },
  { centerU: 0.61, widthU: 0.14, forwardBoost: 0.96, crestOffset: -0.05 },
  { centerU: 0.76, widthU: 0.12, forwardBoost: 0.72, crestOffset: -0.2 },
  { centerU: 0.88, widthU: 0.1, forwardBoost: 0.38, crestOffset: -0.45 },
];

function evaluateChuteProfile(u: number): {
  readonly forwardBoost: number;
  readonly crestOffset: number;
  readonly chuteIntensity: number;
} {
  let forwardBoost = 0;
  let crestOffset = 0;
  let chuteIntensity = 0.18;

  for (const lobe of MAIN_CHUTE_LOBES) {
    const dist = (u - lobe.centerU) / lobe.widthU;
    const bell = Math.exp(-dist * dist * 1.7);
    forwardBoost += bell * lobe.forwardBoost;
    crestOffset += bell * lobe.crestOffset;
    chuteIntensity += bell * 0.88;
  }

  return {
    forwardBoost,
    crestOffset,
    chuteIntensity: clamp({ value: chuteIntensity, min: 0.18, max: 1.0 }),
  };
}

function createSculptedMainWaterfallGeometry(): THREE.BufferGeometry {
  const widthSegments = 104;
  const heightSegments = 92;
  const geometry = new THREE.PlaneGeometry(1, 1, widthSegments, heightSegments);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  const chuteMasks = new Float32Array(posAttr.count);
  const lipTransition = 0.14;

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

    const sideWrapBack = Math.pow(Math.abs(centeredU), 2.5) * 3.1;
    const mainArch = (1 - centeredU * centeredU) * 0.72;

    let y: number;
    let z: number;

    if (progress < lipTransition) {
      const lipT = progress / lipTransition;
      const curvedDrop = Math.pow(lipT, 2.2) * 1.15;
      y = SCENE_CONFIG.crestHeight + 0.15 + profile.crestOffset * 0.45 - curvedDrop;
      z =
        SCENE_CONFIG.crestZ -
        6.2 +
        lipT * 6.45 +
        (profile.forwardBoost * 0.32 + mainArch * 0.35 - sideWrapBack * 0.45) * lipT;
    } else {
      const fallT = (progress - lipTransition) / (1 - lipTransition);
      const startY = SCENE_CONFIG.crestHeight - 1.0 + profile.crestOffset * 0.45;
      const point = computeParabolicFallPoint({
        progress: fallT,
        startY,
        endY: -0.6,
        startZ: SCENE_CONFIG.crestZ + 0.25,
        forwardReach: 3.6 + profile.forwardBoost * 0.65,
      });

      const fluteDepth = profile.forwardBoost * (0.45 + 0.55 * Math.sin(fallT * Math.PI * 0.85));
      y = point.y;
      z = point.z + mainArch + fluteDepth - sideWrapBack;
    }

    posAttr.setXYZ(i, x, y, z);
    chuteMasks[i] = profile.chuteIntensity * (1 - Math.pow(Math.abs(centeredU), 3.6) * 0.6);
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
  const geometry = new THREE.PlaneGeometry(1, 1, 26, 56);
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
      options.widthTop + (options.widthBottom - options.widthTop) * Math.pow(progress, 0.84);
    const x = centerX + centeredU * (width * 0.5);

    const point = computeParabolicFallPoint({
      progress,
      startY: options.startY,
      endY: -0.45,
      startZ: SCENE_CONFIG.crestZ + 0.4,
      forwardReach: options.forwardReach,
    });

    const halfTubeCurve = Math.cos(centeredU * Math.PI * 0.5) * options.archDepth;
    const edgeTuckBack = -Math.pow(Math.abs(centeredU), 2.1) * 1.15;
    const ripple = Math.sin(progress * Math.PI * 3.0 + options.phase) * 0.14 * progress;

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
}): WaterfallSystem {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
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
    readonly depthWrite: boolean;
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
      depthWrite: cfg.depthWrite,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(mat);
    return mat;
  };

  const mainGeometry = createSculptedMainWaterfallGeometry();
  geometriesToDispose.push(mainGeometry);
  const mainMaterial = createWaterfallMat({
    opacity: 0.96,
    speed: 1.52,
    turbulence: 0.9,
    phaseOffset: 0.0,
    coreDensity: 0.82,
    horizontalRepeat: 2.6,
    depthWrite: false,
  });
  const mainMesh = new THREE.Mesh(mainGeometry, mainMaterial);
  mainMesh.renderOrder = 3;
  group.add(mainMesh);

  const outerPlumeConfigs = [
    {
      centerU: 0.28,
      widthTop: 2.9,
      widthBottom: 3.9,
      startY: SCENE_CONFIG.crestHeight - 1.1,
      forwardReach: 4.45,
      archDepth: 0.92,
      phase: 1.7,
      speed: 1.74,
    },
    {
      centerU: 0.48,
      widthTop: 3.4,
      widthBottom: 4.5,
      startY: SCENE_CONFIG.crestHeight - 0.95,
      forwardReach: 4.75,
      archDepth: 1.02,
      phase: 4.2,
      speed: 1.84,
    },
    {
      centerU: 0.69,
      widthTop: 2.9,
      widthBottom: 3.9,
      startY: SCENE_CONFIG.crestHeight - 1.15,
      forwardReach: 4.48,
      archDepth: 0.88,
      phase: 7.5,
      speed: 1.68,
    },
  ];

  for (const cfg of outerPlumeConfigs) {
    const plumeGeo = createVolumetricPlumeVeilGeometry(cfg);
    geometriesToDispose.push(plumeGeo);
    const plumeMat = createWaterfallMat({
      opacity: 0.56,
      speed: cfg.speed,
      turbulence: 1.1,
      phaseOffset: cfg.phase,
      coreDensity: 0.16,
      horizontalRepeat: 1.5,
      depthWrite: false,
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
