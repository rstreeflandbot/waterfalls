import * as THREE from 'three';
import { WaterfallPresetConfig } from './waterfallPresets';

export interface LightingSystem {
  readonly group: THREE.Group;
  readonly sunLight: THREE.DirectionalLight;
  readonly shadowMapSize: number;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

export function createIcelandicLighting(options: {
  readonly scene: THREE.Scene;
  readonly isSoftwareGpu: boolean;
  readonly preset: WaterfallPresetConfig;
}): LightingSystem {
  const { preset } = options;
  const group = new THREE.Group();
  const shadowMapSize = options.isSoftwareGpu ? 1024 : 4096;

  const isForest = preset.id === 'forest';
  options.scene.fog = new THREE.FogExp2(preset.fogColorHex, isForest ? 0.0022 : 0.0052);

  const sunLight = new THREE.DirectionalLight(preset.sunColorHex, preset.sunIntensity);
  sunLight.position.set(
    preset.sunDirection.x * 82,
    preset.sunDirection.y * 82 + 12,
    preset.sunDirection.z * 82,
  );
  sunLight.target.position.set(0, 8, -11);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sunLight.shadow.camera.near = 14;
  sunLight.shadow.camera.far = 185;
  sunLight.shadow.camera.left = -48;
  sunLight.shadow.camera.right = 48;
  sunLight.shadow.camera.top = 44;
  sunLight.shadow.camera.bottom = -18;
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.04;
  group.add(sunLight);
  group.add(sunLight.target);

  const skyHemisphere = new THREE.HemisphereLight(
    preset.hemiSkyHex,
    preset.hemiGroundHex,
    preset.hemiIntensity,
  );
  group.add(skyHemisphere);

  const valleyBounceLight = new THREE.DirectionalLight(preset.bounceHex, preset.bounceIntensity);
  valleyBounceLight.position.set(isForest ? 28 : 36, isForest ? 32 : 22, isForest ? 50 : 48);
  group.add(valleyBounceLight);

  const baseMistIntensity = isForest ? 2.6 : 9.5;
  const mistBounceLight = new THREE.PointLight(
    isForest ? 0xdcecf5 : preset.sunColorHex,
    baseMistIntensity,
    isForest ? 22 : 36,
    isForest ? 1.9 : 1.7,
  );
  mistBounceLight.position.set(
    isForest ? 0.0 : -4.5,
    isForest ? 6.5 : 6.0,
    preset.waterStyle.plungeCenterZ + 4.5,
  );
  group.add(mistBounceLight);

  return {
    group,
    sunLight,
    shadowMapSize,
    update: (elapsedSeconds: number) => {
      mistBounceLight.intensity =
        baseMistIntensity + Math.sin(elapsedSeconds * 1.15) * (isForest ? 0.35 : 0.85);
    },
    dispose: () => {
      sunLight.shadow.map?.dispose();
    },
  };
}
