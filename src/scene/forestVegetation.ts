import * as THREE from 'three';
import { SHARED_ATMOS_AND_SHADOW_GLSL } from '../shaders/sharedShaderGlsl';
import { createSeededRandom, smoothstep } from './cliffMath';
import {
  FOREST_WATERFALL_CONFIG,
  computeForestCanyonTerrainHeight,
  computeForestEscarpmentZ,
  computeForestRiverCenterX,
} from './forestCanyonMath';
import { WaterfallPresetConfig } from './waterfallPresets';

export interface ForestVegetationSystem {
  readonly group: THREE.Group;
  readonly update: (elapsedSeconds: number) => void;
  readonly setShadowUniforms: (options: {
    readonly shadowMap: THREE.Texture;
    readonly shadowMatrix: THREE.Matrix4;
    readonly shadowMapSize: number;
  }) => void;
  readonly dispose: () => void;
}

const FERN_VERTEX_SHADER = /* glsl */ `
attribute vec3 aFernTint;

uniform float uTime;
uniform vec2 uPlungeCenter;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vFernTint;

void main() {
  vUv = uv;
  vFernTint = aFernTint;

  vec4 instOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 away = instOrigin.xz - uPlungeCenter;
  float dist = max(length(away), 0.1);
  vec2 radialDir = away / dist;
  float downdraft = exp(-dist * 0.05) * 0.24;

  float sway = sin(uTime * 1.9 + instOrigin.x * 0.35 + instOrigin.z * 0.31) * 0.08;
  float flutter = sin(uTime * 4.4 + instOrigin.x * 1.3 - instOrigin.z * 0.9) * 0.025;
  float tipFactor = uv.y * uv.y;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
  worldPos.x += (radialDir.x * downdraft + sway + flutter) * tipFactor;
  worldPos.z += (radialDir.y * downdraft + sway * 0.7) * tipFactor;
  worldPos.y -= abs(downdraft + sway) * 0.12 * tipFactor;

  mat3 im = mat3(instanceMatrix);
  mat3 adjugateT = mat3(
    cross(im[1], im[2]),
    cross(im[2], im[0]),
    cross(im[0], im[1])
  );
  vWorldNormal = normalize(mat3(modelMatrix) * adjugateT * normal);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FERN_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDirection;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;

varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
varying vec3 vFernTint;

${SHARED_ATMOS_AND_SHADOW_GLSL}

void main() {
  float centeredX = abs(vUv.x - 0.5) * 2.0;
  float stemWidth = mix(0.28, 0.04, pow(vUv.y, 1.25));
  float pinnaeFreq = vUv.y * 28.0;
  float pinnaeTooth = 0.55 + 0.45 * sin(pinnaeFreq * 3.14159);
  float bladeEnvelope = sin(clamp(vUv.y, 0.0, 1.0) * 3.14159 * 0.94 + 0.06);
  float leafletEdge = max(stemWidth, bladeEnvelope * (0.42 + 0.58 * pinnaeTooth));

  if (centeredX > leafletEdge) {
    discard;
  }

  float midrib = 1.0 - smoothstep(0.0, 0.09, centeredX);
  vec3 sunDir = normalize(uSunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) {
    n = -n;
  }

  float shadow = sampleSunShadowPcf(
    vWorldPos,
    n,
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  vec3 deepEmerald = vec3(0.015, 0.065, 0.018) * vFernTint;
  vec3 brightFrond = vec3(0.068, 0.165, 0.032) * vFernTint;
  vec3 ribTint = vec3(0.042, 0.092, 0.022);
  vec3 albedo = mix(deepEmerald, brightFrond, smoothstep(0.1, 0.95, vUv.y));
  albedo = mix(albedo, ribTint, midrib * 0.45);

  float sunDiffuse = clamp(dot(n, sunDir) * 0.65 + 0.35, 0.0, 1.0) * shadow;
  float sss = pow(max(dot(-viewDir, sunDir), 0.0), 2.8) * shadow * (0.35 + 0.65 * vUv.y);
  float wetSpec = pow(max(dot(n, normalize(sunDir + viewDir)), 0.0), 42.0) * 0.25 * shadow;

  vec3 ambient = vec3(0.055, 0.095, 0.075) * (0.45 + 0.55 * vUv.y);
  vec3 direct = vec3(1.22, 0.92, 0.54) * sunDiffuse * 0.85;
  vec3 translucency = vec3(0.48, 0.72, 0.14) * sss * 0.92;

  vec3 color = albedo * (ambient + direct) + translucency + vec3(0.85, 0.92, 0.75) * wetSpec;
  color = applyLinearHeightFog(color, vWorldPos, cameraPosition, sunDir);

  gl_FragColor = vec4(color, 1.0);
}
`;

function createFernRosetteGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const frondCount = 9;
  const lengthSegments = 6;
  let vertexOffset = 0;

  for (let f = 0; f < frondCount; f++) {
    const yaw = (f / frondCount) * Math.PI * 2 + (f % 2) * 0.22;
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const frondLen = 0.78 + (f % 3) * 0.16;
    const archHeight = 0.34 + (f % 2) * 0.12;
    const maxWidth = 0.24;

    for (let s = 0; s <= lengthSegments; s++) {
      const t = s / lengthSegments;
      const forward = t * frondLen;
      const y = Math.sin(t * Math.PI * 0.78) * archHeight + t * 0.06;
      const halfW = maxWidth * Math.sin(Math.pow(t, 0.7) * Math.PI * 0.92 + 0.08);
      const droop = Math.pow(t, 2.2) * 0.05;

      const lx = -halfW;
      const rx = halfW;

      const worldLx = lx * cosY - forward * sinY;
      const worldLz = lx * sinY + forward * cosY;
      const worldRx = rx * cosY - forward * sinY;
      const worldRz = rx * sinY + forward * cosY;

      positions.push(worldLx, y - droop, worldLz, worldRx, y - droop, worldRz);
      normals.push(0, 1, 0, 0, 1, 0);
      uvs.push(0, t, 1, t);
    }

    for (let s = 0; s < lengthSegments; s++) {
      const base = vertexOffset + s * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    vertexOffset += (lengthSegments + 1) * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createConiferCanopyGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const rand = createSeededRandom(44201);

  const tierCount = 8;
  const radialSegs = 9;

  for (let tier = 0; tier < tierCount; tier++) {
    const t = tier / (tierCount - 1);
    const tierBaseY = 0.24 + t * 0.64;
    const tierHeight = 0.22 * (1 - t * 0.42);
    const tierRadius = 0.42 * (1 - t * 0.78) + 0.05;
    const twist = tier * 0.55;

    const shade = 0.48 + t * 0.52;
    const tipColor = new THREE.Color(0x1f3a20).multiplyScalar(shade);
    const skirtColor = new THREE.Color(0x0c1b0e).multiplyScalar(0.75 + t * 0.35);

    const ringPts: Array<{ readonly x: number; readonly y: number; readonly z: number }> = [];
    for (let s = 0; s < radialSegs; s++) {
      const angle = (s / radialSegs) * Math.PI * 2 + twist;
      const jitterR = tierRadius * (0.78 + rand() * 0.42);
      const droopY = tierBaseY - 0.045 * (1 - t * 0.5) * (0.7 + rand() * 0.6);
      ringPts.push({
        x: Math.cos(angle) * jitterR,
        y: droopY,
        z: Math.sin(angle) * jitterR,
      });
    }

    const apexY = tierBaseY + tierHeight;

    for (let s = 0; s < radialSegs; s++) {
      const p0 = ringPts[s];
      const p1 = ringPts[(s + 1) % radialSegs];
      if (!p0 || !p1) {
        continue;
      }

      const vA = new THREE.Vector3(0, apexY, 0);
      const vB = new THREE.Vector3(p1.x, p1.y, p1.z);
      const vC = new THREE.Vector3(p0.x, p0.y, p0.z);
      const faceNormal = new THREE.Vector3()
        .subVectors(vB, vA)
        .cross(new THREE.Vector3().subVectors(vC, vA))
        .normalize();

      positions.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      normals.push(
        faceNormal.x,
        faceNormal.y,
        faceNormal.z,
        faceNormal.x,
        faceNormal.y,
        faceNormal.z,
        faceNormal.x,
        faceNormal.y,
        faceNormal.z,
      );
      colors.push(
        tipColor.r,
        tipColor.g,
        tipColor.b,
        skirtColor.r,
        skirtColor.g,
        skirtColor.b,
        skirtColor.r,
        skirtColor.g,
        skirtColor.b,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function computeForestSlope(coords: { readonly x: number; readonly z: number }): number {
  const eps = 0.65;
  const hC = computeForestCanyonTerrainHeight(coords);
  const hR = computeForestCanyonTerrainHeight({ x: coords.x + eps, z: coords.z });
  const hF = computeForestCanyonTerrainHeight({ x: coords.x, z: coords.z + eps });
  return Math.hypot((hR - hC) / eps, (hF - hC) / eps);
}

export function createForestVegetation(options: {
  readonly preset: WaterfallPresetConfig;
  readonly isSoftwareGpu: boolean;
  readonly fallbackShadowTexture: THREE.Texture;
}): ForestVegetationSystem {
  const group = new THREE.Group();
  const rand = createSeededRandom(62041);

  const sunDir = new THREE.Vector3(
    options.preset.sunDirection.x,
    options.preset.sunDirection.y,
    options.preset.sunDirection.z,
  ).normalize();

  const trunkGeo = new THREE.CylinderGeometry(0.032, 0.085, 0.42, 6);
  trunkGeo.translate(0, 0.21, 0);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2a1f18),
    roughness: 0.94,
    metalness: 0.02,
  });

  const canopyGeo = createConiferCanopyGeometry();
  const canopyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  const treeCountTarget = options.isSoftwareGpu ? 95 : 185;
  const treeMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();

  for (
    let attempt = 0;
    attempt < treeCountTarget * 7 && treeMatrices.length < treeCountTarget;
    attempt++
  ) {
    const isRimTree = attempt % 2 === 0;
    const x = isRimTree ? (rand() - 0.5) * 108 : (rand() > 0.5 ? 1 : -1) * (17.5 + rand() * 48);
    const z = isRimTree ? -54 + rand() * 40 : -20 + rand() * 58;

    if (Math.abs(x) < 6.8 && z > -24 && z < 8) {
      continue;
    }

    const camClearDist = Math.hypot(x - 20.5, z - 48.2);
    if (camClearDist < 16) {
      continue;
    }

    const riverCenter = computeForestRiverCenterX(z);
    if (Math.abs(x - riverCenter) < 12.5 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 2.4 || y > 48) {
      continue;
    }

    const slope = computeForestSlope({ x, z });
    if (slope > 0.82) {
      continue;
    }

    const treeHeight = 9.5 + rand() * 11.5;
    const treeWidth = treeHeight * (0.68 + rand() * 0.26);
    dummy.position.set(x, y - 0.35, z);
    dummy.rotation.set((rand() - 0.5) * 0.08, rand() * Math.PI * 2, (rand() - 0.5) * 0.08);
    dummy.scale.set(treeWidth, treeHeight, treeWidth);
    dummy.updateMatrix();
    treeMatrices.push(dummy.matrix.clone());
  }

  const trunksInstanced = new THREE.InstancedMesh(trunkGeo, trunkMat, treeMatrices.length);
  trunksInstanced.castShadow = true;
  trunksInstanced.receiveShadow = true;

  const canopiesInstanced = new THREE.InstancedMesh(canopyGeo, canopyMat, treeMatrices.length);
  canopiesInstanced.castShadow = true;
  canopiesInstanced.receiveShadow = true;

  for (let i = 0; i < treeMatrices.length; i++) {
    const m = treeMatrices[i];
    if (!m) {
      continue;
    }
    trunksInstanced.setMatrixAt(i, m);
    canopiesInstanced.setMatrixAt(i, m);
  }
  trunksInstanced.instanceMatrix.needsUpdate = true;
  canopiesInstanced.instanceMatrix.needsUpdate = true;
  group.add(trunksInstanced);
  group.add(canopiesInstanced);

  const fernGeo = createFernRosetteGeometry();
  const fernUniforms = {
    uTime: { value: 0 },
    uPlungeCenter: { value: new THREE.Vector2(0, FOREST_WATERFALL_CONFIG.plungeCenterZ) },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
  };
  const fernMat = new THREE.ShaderMaterial({
    vertexShader: FERN_VERTEX_SHADER,
    fragmentShader: FERN_FRAGMENT_SHADER,
    uniforms: fernUniforms,
    side: THREE.DoubleSide,
  });

  const fernTarget = options.isSoftwareGpu ? 240 : 520;
  const fernMatrices: THREE.Matrix4[] = [];
  const fernTints: number[] = [];

  for (let attempt = 0; attempt < fernTarget * 6 && fernMatrices.length < fernTarget; attempt++) {
    const x = (rand() - 0.5) * 68;
    const z = -19 + rand() * 68;

    const distToFalls = Math.hypot(x * 0.72, z - FOREST_WATERFALL_CONFIG.plungeCenterZ);
    if (distToFalls < 6.8) {
      continue;
    }

    const riverCenter = computeForestRiverCenterX(z);
    const riverHalfWidth =
      6.8 +
      Math.exp(-Math.pow((z - (FOREST_WATERFALL_CONFIG.plungeCenterZ + 4.0)) / 9.5, 2)) * 5.4 +
      smoothstep({ edge0: 14, edge1: 88, value: z }) * 8.2;
    if (Math.abs(x - riverCenter) < riverHalfWidth + 0.3 && z > computeForestEscarpmentZ(x)) {
      continue;
    }

    const y = computeForestCanyonTerrainHeight({ x, z });
    if (y < 0.45 || y > 28) {
      continue;
    }

    const slope = computeForestSlope({ x, z });
    if (slope > 0.85) {
      continue;
    }

    const scale = 0.72 + rand() * 1.15;
    dummy.position.set(x, y - 0.08, z);
    dummy.rotation.set((rand() - 0.5) * 0.28, rand() * Math.PI * 2, (rand() - 0.5) * 0.28);
    dummy.scale.set(scale, scale * (0.85 + rand() * 0.35), scale);
    dummy.updateMatrix();
    fernMatrices.push(dummy.matrix.clone());

    const warmth = rand();
    fernTints.push(0.85 + warmth * 0.35, 0.92 + rand() * 0.24, 0.78 + rand() * 0.2);
  }

  const fernsInstanced = new THREE.InstancedMesh(fernGeo, fernMat, fernMatrices.length);
  fernsInstanced.frustumCulled = false;
  for (let i = 0; i < fernMatrices.length; i++) {
    const m = fernMatrices[i];
    if (!m) {
      continue;
    }
    fernsInstanced.setMatrixAt(i, m);
  }
  fernsInstanced.instanceMatrix.needsUpdate = true;
  fernGeo.setAttribute(
    'aFernTint',
    new THREE.InstancedBufferAttribute(new Float32Array(fernTints), 3),
  );
  group.add(fernsInstanced);

  return {
    group,
    update: (elapsedSeconds: number) => {
      fernUniforms.uTime.value = elapsedSeconds;
    },
    setShadowUniforms: (shadowOptions) => {
      fernUniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      fernUniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      fernUniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
    },
    dispose: () => {
      trunkGeo.dispose();
      trunkMat.dispose();
      canopyGeo.dispose();
      canopyMat.dispose();
      fernGeo.dispose();
      fernMat.dispose();
    },
  };
}
