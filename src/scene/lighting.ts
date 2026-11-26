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

  options.scene.fog = new THREE.FogExp2(preset.fogColorHex, 0.0052);

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
  valleyBounceLight.position.set(36, 22, 48);
  group.add(valleyBounceLight);

  const mistBounceLight = new THREE.PointLight(preset.sunColorHex, 9.5, 36, 1.8);
  mistBounceLight.position.set(-4.5, 6.0, preset.waterStyle.plungeCenterZ + 4.5);
  group.add(mistBounceLight);

  return {
    group,
    sunLight,
    shadowMapSize,
    update: (elapsedSeconds: number) => {
      mistBounceLight.intensity = 9.0 + Math.sin(elapsedSeconds * 1.15) * 0.85;
    },
    dispose: () => {
      sunLight.shadow.map?.dispose();
    },
  };
}
