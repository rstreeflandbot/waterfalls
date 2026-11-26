import * as THREE from 'three';
import { WATER_POOL_FRAGMENT_SHADER, WATER_POOL_VERTEX_SHADER } from '../shaders/waterPoolShaders';
import { SCENE_CONFIG } from './cliffMath';

export interface WaterPoolSystem {
  readonly mesh: THREE.Mesh;
  readonly update: (elapsedSeconds: number) => void;
  readonly setSceneTextures: (options: {
    readonly colorTexture: THREE.Texture;
    readonly depthTexture: THREE.Texture;
    readonly reflectionTexture: THREE.Texture;
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

export function createGlacialWaterPool(options: {
  readonly noiseTexture: THREE.DataTexture;
  readonly foamTexture: THREE.DataTexture;
  readonly fallbackTexture: THREE.Texture;
}): WaterPoolSystem {
  const geometry = new THREE.PlaneGeometry(156, 176, 150, 160);
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
    tSceneColor: { value: options.fallbackTexture },
    tSceneDepth: { value: options.fallbackTexture },
    tReflection: { value: options.fallbackTexture },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uCameraNear: { value: 0.25 },
    uCameraFar: { value: 520 },
    uSunShadowMap: { value: options.fallbackTexture },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader: WATER_POOL_VERTEX_SHADER,
    fragmentShader: WATER_POOL_FRAGMENT_SHADER,
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0, SCENE_CONFIG.poolSurfaceY, 60.0);
  mesh.renderOrder = 1;

  return {
    mesh,
    update: (elapsedSeconds: number) => {
      uniforms.uTime.value = elapsedSeconds;
    },
    setSceneTextures: (sceneOpts) => {
      uniforms.tSceneColor.value = sceneOpts.colorTexture;
      uniforms.tSceneDepth.value = sceneOpts.depthTexture;
      uniforms.tReflection.value = sceneOpts.reflectionTexture;
      uniforms.uResolution.value.set(sceneOpts.width, sceneOpts.height);
      uniforms.uCameraNear.value = sceneOpts.cameraNear;
      uniforms.uCameraFar.value = sceneOpts.cameraFar;
    },
    setShadowUniforms: (shadowOpts) => {
      uniforms.uSunShadowMap.value = shadowOpts.shadowMap;
      uniforms.uSunShadowMatrix.value.copy(shadowOpts.shadowMatrix);
      uniforms.uShadowMapSize.value = shadowOpts.shadowMapSize;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
