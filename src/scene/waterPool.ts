import * as THREE from 'three';
import { WATER_POOL_FRAGMENT_SHADER, WATER_POOL_VERTEX_SHADER } from '../shaders/waterPoolShaders';
import { SCENE_CONFIG } from './cliffMath';
import { WaterfallPresetConfig } from './waterfallPresets';

export interface WaterPoolSystem {
  readonly mesh: THREE.Mesh;
  readonly update: (elapsedSeconds: number) => void;
  readonly applyPreset: (preset: WaterfallPresetConfig) => void;
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
  readonly preset: WaterfallPresetConfig;
}): WaterPoolSystem {
  const geometry = new THREE.PlaneGeometry(156, 176, 150, 160);
  geometry.rotateX(-Math.PI / 2);

  const style = options.preset.waterStyle;
  const sunDir = new THREE.Vector3(
    options.preset.sunDirection.x,
    options.preset.sunDirection.y,
    options.preset.sunDirection.z,
  ).normalize();

  const uniforms = {
    uTime: { value: 0 },
    uPlungeCenter: { value: new THREE.Vector2(0, style.plungeCenterZ) },
    uSunDirection: { value: sunDir },
    uWaterAbsorption: {
      value: new THREE.Vector3(style.absorption[0], style.absorption[1], style.absorption[2]),
    },
    uWaterDeepScatter: {
      value: new THREE.Vector3(style.deepScatter[0], style.deepScatter[1], style.deepScatter[2]),
    },
    uWaterAeratedGlow: {
      value: new THREE.Vector3(style.aeratedGlow[0], style.aeratedGlow[1], style.aeratedGlow[2]),
    },
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
    applyPreset: (preset) => {
      uniforms.uPlungeCenter.value.set(0, preset.waterStyle.plungeCenterZ);
      uniforms.uSunDirection.value
        .set(preset.sunDirection.x, preset.sunDirection.y, preset.sunDirection.z)
        .normalize();
      uniforms.uWaterAbsorption.value.set(
        preset.waterStyle.absorption[0],
        preset.waterStyle.absorption[1],
        preset.waterStyle.absorption[2],
      );
      uniforms.uWaterDeepScatter.value.set(
        preset.waterStyle.deepScatter[0],
        preset.waterStyle.deepScatter[1],
        preset.waterStyle.deepScatter[2],
      );
      uniforms.uWaterAeratedGlow.value.set(
        preset.waterStyle.aeratedGlow[0],
        preset.waterStyle.aeratedGlow[1],
        preset.waterStyle.aeratedGlow[2],
      );
      uniforms.uForestMode.value = preset.id === 'forest' ? 1 : 0;
      uniforms.uFogCool.value.set(
        preset.fogLinearCool[0],
        preset.fogLinearCool[1],
        preset.fogLinearCool[2],
      );
      uniforms.uFogWarm.value.set(
        preset.fogLinearWarm[0],
        preset.fogLinearWarm[1],
        preset.fogLinearWarm[2],
      );
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
