import * as THREE from 'three';
import { WATER_POOL_FRAGMENT_SHADER, WATER_POOL_VERTEX_SHADER } from '../shaders/waterPoolShaders';
import { SCENE_CONFIG } from './cliffMath';

export interface WaterPoolSystem {
  readonly mesh: THREE.Mesh;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

export function createGlacialWaterPool(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly foamTexture: THREE.DataTexture;
}): WaterPoolSystem {
  const geometry = new THREE.PlaneGeometry(140, 165, 140, 150);
  geometry.rotateX(-Math.PI / 2);

  const sunDir = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
  ).normalize();

  const uniforms = {
    uTime: { value: 0 },
    uPlungeCenter: { value: new THREE.Vector2(0, SCENE_CONFIG.plungeCenterZ + 0.5) },
    uSunDirection: { value: sunDir },
    uNoiseTex: { value: options.noiseTexture },
    uFoamTex: { value: options.foamTexture },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_POOL_VERTEX_SHADER,
    fragmentShader: WATER_POOL_FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, SCENE_CONFIG.poolSurfaceY, 64.0);
  mesh.renderOrder = 1;

  return {
    mesh,
    update: (elapsedSeconds: number) => {
      uniforms.uTime.value = elapsedSeconds;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
