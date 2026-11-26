import * as THREE from 'three';
import { SHARED_ATMOS_AND_SHADOW_GLSL } from '../shaders/sharedShaderGlsl';
import {
  SCENE_CONFIG,
  computeEscarpmentLineZ,
  computeOpenVolcanicTerrainHeight,
  computeRiverCenterX,
  createSeededRandom,
  smoothstep,
} from './cliffMath';

export interface FoliageSystem {
  readonly mesh: THREE.InstancedMesh;
  readonly update: (elapsedSeconds: number) => void;
  readonly setShadowUniforms: (options: {
    readonly shadowMap: THREE.Texture;
    readonly shadowMatrix: THREE.Matrix4;
    readonly shadowMapSize: number;
  }) => void;
  readonly dispose: () => void;
}

const GRASS_VERTEX_SHADER = /* glsl */ `
attribute vec3 aBladeTint;

uniform float uTime;
uniform vec2 uPlungeCenter;

varying float vHeightT;
varying vec3 vWorldPos;
varying vec3 vBladeTint;

void main() {
  vHeightT = uv.y;
  vBladeTint = aBladeTint;

  vec3 localPos = position;
  vec4 instOrigin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

  vec2 awayFromFalls = instOrigin.xz - uPlungeCenter;
  float distToFalls = max(length(awayFromFalls), 0.1);
  vec2 radialDir = awayFromFalls / distToFalls;
  float downdraft = exp(-distToFalls * 0.055) * 0.42;

  float gust = sin(uTime * 2.1 + instOrigin.x * 0.35 + instOrigin.z * 0.28) * 0.16;
  float flutter = sin(uTime * 5.2 + instOrigin.x * 1.4 - instOrigin.z * 1.1) * 0.05;
  float bendAmount = uv.y * uv.y;

  vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
  worldPos.x += (radialDir.x * downdraft + gust + flutter) * bendAmount;
  worldPos.z += (radialDir.y * downdraft + gust * 0.7) * bendAmount;
  worldPos.y -= abs(downdraft + gust) * 0.14 * bendAmount;

  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const GRASS_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uSunDirection;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uShadowMapSize;

varying float vHeightT;
varying vec3 vWorldPos;
varying vec3 vBladeTint;

${SHARED_ATMOS_AND_SHADOW_GLSL}

void main() {
  vec3 sunDir = normalize(uSunDirection);
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 upNormal = vec3(0.0, 1.0, 0.0);

  float shadow = sampleSunShadowPcf(
    vWorldPos,
    upNormal,
    sunDir,
    uSunShadowMap,
    uSunShadowMatrix,
    uShadowMapSize
  );

  vec3 rootColor = vec3(0.016, 0.028, 0.008) * vBladeTint;
  vec3 tipColor = vec3(0.085, 0.125, 0.032) * vBladeTint;
  vec3 albedo = mix(rootColor, tipColor, smoothstep(0.0, 1.0, vHeightT));

  float sunFacing = max(dot(upNormal, sunDir), 0.0) * shadow;
  float sss = pow(max(dot(-viewDir, sunDir), 0.0), 3.0) * shadow * vHeightT;

  vec3 skyAmbient = vec3(0.055, 0.075, 0.095) * (0.45 + 0.55 * vHeightT);
  vec3 directSun = vec3(1.15, 0.74, 0.42) * sunFacing * 0.75;
  vec3 translucency = vec3(0.55, 0.62, 0.14) * sss * 0.85;

  vec3 color = albedo * (skyAmbient + directSun) + translucency;
  color = applyLinearHeightFog(color, vWorldPos, cameraPosition, sunDir);

  gl_FragColor = vec4(color, 1.0);
}
`;

function createCurvedBladeGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -0.035, 0.0, 0.0, 0.035, 0.0, 0.0, -0.026, 0.24, 0.025, 0.026, 0.24, 0.025, -0.012, 0.48, 0.085,
    0.012, 0.48, 0.085, 0.0, 0.72, 0.18,
  ]);

  const uvs = new Float32Array([0, 0, 1, 0, 0, 0.35, 1, 0.35, 0, 0.7, 1, 0.7, 0.5, 1.0]);

  const indices = [0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createHighlandFoliage(options: {
  readonly isSoftwareGpu: boolean;
  readonly isMobileGpu: boolean;
  readonly fallbackShadowTexture: THREE.Texture;
}): FoliageSystem {
  const maxBlades = options.isSoftwareGpu ? 3500 : options.isMobileGpu ? 9500 : 16000;
  const geometry = createCurvedBladeGeometry();
  const rand = createSeededRandom(314159);

  const sunDir = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
  ).normalize();

  const uniforms = {
    uTime: { value: 0 },
    uPlungeCenter: { value: new THREE.Vector2(0, SCENE_CONFIG.plungeCenterZ) },
    uSunDirection: { value: sunDir },
    uSunShadowMap: { value: options.fallbackShadowTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: GRASS_VERTEX_SHADER,
    fragmentShader: GRASS_FRAGMENT_SHADER,
    uniforms,
    side: THREE.DoubleSide,
  });

  const placements: Array<{
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly scale: number;
    readonly rotY: number;
    readonly tilt: number;
    readonly tintR: number;
    readonly tintG: number;
    readonly tintB: number;
  }> = [];

  for (let attempt = 0; attempt < maxBlades * 3 && placements.length < maxBlades; attempt++) {
    const x = (rand() - 0.5) * 96;
    const z = -28 + rand() * 76;

    const distToFalls = Math.hypot(x * 0.72, z - SCENE_CONFIG.plungeCenterZ);
    if (distToFalls < 7.8) {
      continue;
    }

    const riverCenter = computeRiverCenterX(z);
    const riverHalfWidth =
      8.0 +
      Math.exp(-Math.pow((z - (SCENE_CONFIG.plungeCenterZ + 4)) / 10, 2)) * 5.6 +
      smoothstep({ edge0: 14, edge1: 95, value: z }) * 9.5;
    if (Math.abs(x - riverCenter) < riverHalfWidth + 0.6 && z > computeEscarpmentLineZ(x)) {
      continue;
    }

    const y = computeOpenVolcanicTerrainHeight({ x, z });
    if (y < 1.15 || y > 34) {
      continue;
    }

    const eps = 0.5;
    const hR = computeOpenVolcanicTerrainHeight({ x: x + eps, z });
    const hF = computeOpenVolcanicTerrainHeight({ x, z: z + eps });
    const slope = Math.hypot((hR - y) / eps, (hF - y) / eps);
    if (slope > 0.72) {
      continue;
    }

    const clumpScale = 0.55 + rand() * 1.15;
    const goldenDryness = rand();
    placements.push({
      x,
      y: y - 0.04,
      z,
      scale: clumpScale,
      rotY: rand() * Math.PI * 2,
      tilt: (rand() - 0.5) * 0.35,
      tintR: 0.85 + goldenDryness * 0.45,
      tintG: 0.9 + rand() * 0.25,
      tintB: 0.7 + rand() * 0.25,
    });
  }

  const tints = new Float32Array(placements.length * 3);
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < placements.length; i++) {
    const blade = placements[i];
    if (!blade) {
      continue;
    }
    dummy.position.set(blade.x, blade.y, blade.z);
    dummy.rotation.set(blade.tilt, blade.rotY, 0);
    dummy.scale.set(blade.scale, blade.scale, blade.scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    tints[i * 3] = blade.tintR;
    tints[i * 3 + 1] = blade.tintG;
    tints[i * 3 + 2] = blade.tintB;
  }
  mesh.instanceMatrix.needsUpdate = true;
  geometry.setAttribute('aBladeTint', new THREE.InstancedBufferAttribute(tints, 3));

  return {
    mesh,
    update: (elapsedSeconds: number) => {
      uniforms.uTime.value = elapsedSeconds;
    },
    setShadowUniforms: (shadowOptions) => {
      uniforms.uSunShadowMap.value = shadowOptions.shadowMap;
      uniforms.uSunShadowMatrix.value.copy(shadowOptions.shadowMatrix);
      uniforms.uShadowMapSize.value = shadowOptions.shadowMapSize;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
