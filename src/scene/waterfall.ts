import * as THREE from 'three';
import {
  PLUNGE_BOIL_FRAGMENT_SHADER,
  PLUNGE_BOIL_VERTEX_SHADER,
  WATERFALL_CURTAIN_FRAGMENT_SHADER,
  WATERFALL_CURTAIN_VERTEX_SHADER,
} from '../shaders/waterfallShaders';
import { SCENE_CONFIG, computeParabolicFallPoint } from './cliffMath';

export interface WaterfallSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

interface CurtainSpec {
  readonly widthTop: number;
  readonly widthBottom: number;
  readonly startY: number;
  readonly endY: number;
  readonly startZ: number;
  readonly forwardReach: number;
  readonly centerX: number;
  readonly archDepth: number;
  readonly opacity: number;
  readonly speed: number;
  readonly turbulence: number;
  readonly phaseOffset: number;
  readonly coreDensity: number;
  readonly renderOrder: number;
}

function createParabolicCurtainGeometry(spec: CurtainSpec): THREE.BufferGeometry {
  const widthSegments = 32;
  const heightSegments = 44;
  const geometry = new THREE.PlaneGeometry(1, 1, widthSegments, heightSegments);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const progress = 1 - v;
    const centeredU = (u - 0.5) * 2;

    const widthAtY = spec.widthTop + (spec.widthBottom - spec.widthTop) * Math.pow(progress, 0.85);
    const x = spec.centerX + centeredU * (widthAtY * 0.5);

    const point = computeParabolicFallPoint({
      progress,
      startY: spec.startY,
      endY: spec.endY,
      startZ: spec.startZ,
      forwardReach: spec.forwardReach,
    });

    const archCurve = (1 - centeredU * centeredU) * spec.archDepth;
    const organicWave = Math.sin(centeredU * Math.PI * 2.5 + spec.phaseOffset) * 0.16 * progress;

    posAttr.setXYZ(i, x, point.y, point.z + archCurve + organicWave);
  }

  geometry.computeVertexNormals();
  return geometry;
}

function createCrestGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(SCENE_CONFIG.crestWidth + 0.6, 5.2, 28, 18);
  const posAttr = geometry.attributes.position;
  const uvAttr = geometry.attributes.uv;

  if (!posAttr || !uvAttr) {
    return geometry;
  }

  for (let i = 0; i < posAttr.count; i++) {
    const u = uvAttr.getX(i);
    const v = uvAttr.getY(i);
    const centeredU = (u - 0.5) * 2;
    const progress = 1 - v;

    const x = centeredU * (SCENE_CONFIG.crestWidth * 0.52);
    const z = SCENE_CONFIG.crestZ - 4.4 + progress * 4.65;
    const lipDrop = Math.pow(Math.max(0, progress - 0.65) / 0.35, 2.2) * 1.15;
    const channelCup = centeredU * centeredU * 0.22;
    const y = SCENE_CONFIG.crestHeight + 0.2 - lipDrop + channelCup;

    posAttr.setXYZ(i, x, y, z);
  }

  geometry.computeVertexNormals();
  return geometry;
}

export function createIcelandicWaterfall(noiseTexture: THREE.DataTexture): WaterfallSystem {
  const group = new THREE.Group();
  const sunDir = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
  ).normalize();

  const curtainSpecs: CurtainSpec[] = [
    {
      widthTop: SCENE_CONFIG.crestWidth * 0.88,
      widthBottom: SCENE_CONFIG.plungeWidth * 0.86,
      startY: SCENE_CONFIG.crestHeight - 0.1,
      endY: -0.4,
      startZ: SCENE_CONFIG.crestZ - 0.35,
      forwardReach: 2.85,
      centerX: 0,
      archDepth: 0.45,
      opacity: 0.96,
      speed: 1.52,
      turbulence: 0.55,
      phaseOffset: 0.0,
      coreDensity: 0.9,
      renderOrder: 2,
    },
    {
      widthTop: SCENE_CONFIG.crestWidth * 0.98,
      widthBottom: SCENE_CONFIG.plungeWidth * 0.98,
      startY: SCENE_CONFIG.crestHeight,
      endY: -0.35,
      startZ: SCENE_CONFIG.crestZ,
      forwardReach: 3.25,
      centerX: 0,
      archDepth: 0.72,
      opacity: 0.82,
      speed: 1.74,
      turbulence: 0.95,
      phaseOffset: 2.3,
      coreDensity: 0.45,
      renderOrder: 3,
    },
    {
      widthTop: SCENE_CONFIG.crestWidth * 1.05,
      widthBottom: SCENE_CONFIG.plungeWidth * 1.12,
      startY: SCENE_CONFIG.crestHeight + 0.05,
      endY: -0.25,
      startZ: SCENE_CONFIG.crestZ + 0.25,
      forwardReach: 3.7,
      centerX: 0.12,
      archDepth: 0.95,
      opacity: 0.56,
      speed: 1.98,
      turbulence: 1.35,
      phaseOffset: 4.9,
      coreDensity: 0.12,
      renderOrder: 4,
    },
    {
      widthTop: 1.35,
      widthBottom: 1.95,
      startY: SCENE_CONFIG.crestHeight - 1.4,
      endY: -0.2,
      startZ: SCENE_CONFIG.crestZ - 0.1,
      forwardReach: 2.6,
      centerX: -4.45,
      archDepth: 0.2,
      opacity: 0.62,
      speed: 1.35,
      turbulence: 0.6,
      phaseOffset: 7.4,
      coreDensity: 0.2,
      renderOrder: 3,
    },
    {
      widthTop: 1.15,
      widthBottom: 1.75,
      startY: SCENE_CONFIG.crestHeight - 2.2,
      endY: -0.2,
      startZ: SCENE_CONFIG.crestZ + 0.3,
      forwardReach: 2.35,
      centerX: 4.55,
      archDepth: 0.2,
      opacity: 0.58,
      speed: 1.28,
      turbulence: 0.55,
      phaseOffset: 10.1,
      coreDensity: 0.18,
      renderOrder: 3,
    },
    {
      widthTop: 0.75,
      widthBottom: 1.15,
      startY: SCENE_CONFIG.crestHeight - 3.6,
      endY: -0.1,
      startZ: SCENE_CONFIG.crestZ + 1.15,
      forwardReach: 1.75,
      centerX: -6.15,
      archDepth: 0.12,
      opacity: 0.44,
      speed: 1.12,
      turbulence: 0.42,
      phaseOffset: 13.7,
      coreDensity: 0.1,
      renderOrder: 3,
    },
    {
      widthTop: 0.72,
      widthBottom: 1.1,
      startY: SCENE_CONFIG.crestHeight - 4.1,
      endY: -0.1,
      startZ: SCENE_CONFIG.crestZ + 1.3,
      forwardReach: 1.65,
      centerX: 6.3,
      archDepth: 0.12,
      opacity: 0.42,
      speed: 1.08,
      turbulence: 0.4,
      phaseOffset: 16.2,
      coreDensity: 0.1,
      renderOrder: 3,
    },
  ];

  const timeUniforms: Array<{ value: number }> = [];
  const geometriesToDispose: THREE.BufferGeometry[] = [];
  const materialsToDispose: THREE.Material[] = [];

  for (const spec of curtainSpecs) {
    const geometry = createParabolicCurtainGeometry(spec);
    geometriesToDispose.push(geometry);

    const uTime = { value: 0 };
    timeUniforms.push(uTime);

    const material = new THREE.ShaderMaterial({
      vertexShader: WATERFALL_CURTAIN_VERTEX_SHADER,
      fragmentShader: WATERFALL_CURTAIN_FRAGMENT_SHADER,
      uniforms: {
        uTime,
        uOpacity: { value: spec.opacity },
        uSpeed: { value: spec.speed },
        uTurbulence: { value: spec.turbulence },
        uPhaseOffset: { value: spec.phaseOffset },
        uCoreDensity: { value: spec.coreDensity },
        uSunDirection: { value: sunDir },
        uNoiseTex: { value: noiseTexture },
      },
      transparent: true,
      depthWrite: spec.coreDensity > 0.7,
      side: THREE.DoubleSide,
    });
    materialsToDispose.push(material);

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = spec.renderOrder;
    group.add(mesh);
  }

  const crestGeometry = createCrestGeometry();
  geometriesToDispose.push(crestGeometry);
  const crestTime = { value: 0 };
  timeUniforms.push(crestTime);
  const crestMaterial = new THREE.ShaderMaterial({
    vertexShader: WATERFALL_CURTAIN_VERTEX_SHADER,
    fragmentShader: WATERFALL_CURTAIN_FRAGMENT_SHADER,
    uniforms: {
      uTime: crestTime,
      uOpacity: { value: 0.92 },
      uSpeed: { value: 1.15 },
      uTurbulence: { value: 0.25 },
      uPhaseOffset: { value: 1.4 },
      uCoreDensity: { value: 0.72 },
      uSunDirection: { value: sunDir },
      uNoiseTex: { value: noiseTexture },
    },
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  materialsToDispose.push(crestMaterial);
  const crestMesh = new THREE.Mesh(crestGeometry, crestMaterial);
  crestMesh.renderOrder = 2;
  group.add(crestMesh);

  const boilGeometry = new THREE.PlaneGeometry(11.8, 6.2, 40, 28);
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
      uNoiseTex: { value: noiseTexture },
    },
    transparent: true,
    depthWrite: false,
  });
  materialsToDispose.push(boilMaterial);

  const boilMesh = new THREE.Mesh(boilGeometry, boilMaterial);
  boilMesh.position.set(0, SCENE_CONFIG.poolSurfaceY + 0.08, SCENE_CONFIG.plungeCenterZ + 0.55);
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
