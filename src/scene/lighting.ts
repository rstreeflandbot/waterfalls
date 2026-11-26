import * as THREE from 'three';
import { IcelandWaterfallConfig } from './icelandConfig';

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
  readonly isMobileGpu: boolean;
  readonly config: IcelandWaterfallConfig;
}): LightingSystem {
  const { config } = options;
  const group = new THREE.Group();
  const shadowMapSize = options.isSoftwareGpu ? 1024 : options.isMobileGpu ? 2048 : 4096;

  options.scene.fog = new THREE.FogExp2(config.fogColorHex, 0.0052);

  const sunLight = new THREE.DirectionalLight(config.sunColorHex, config.sunIntensity);
  sunLight.position.set(
    config.sunDirection.x * 82,
    config.sunDirection.y * 82 + 12,
    config.sunDirection.z * 82,
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
    config.hemiSkyHex,
    config.hemiGroundHex,
    config.hemiIntensity,
  );
  group.add(skyHemisphere);

  const valleyBounceLight = new THREE.DirectionalLight(config.bounceHex, config.bounceIntensity);
  valleyBounceLight.position.set(36, 22, 48);
  group.add(valleyBounceLight);

  const baseMistIntensity = 9.5;
  const mistBounceLight = new THREE.PointLight(config.sunColorHex, baseMistIntensity, 36, 1.7);
  mistBounceLight.position.set(-4.5, 6.0, config.waterStyle.plungeCenterZ + 4.5);
  group.add(mistBounceLight);

  return {
    group,
    sunLight,
    shadowMapSize,
    update: (elapsedSeconds: number) => {
      mistBounceLight.intensity = baseMistIntensity + Math.sin(elapsedSeconds * 1.15) * 0.85;
    },
    dispose: () => {
      sunLight.shadow.map?.dispose();
    },
  };
}
