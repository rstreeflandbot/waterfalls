import * as THREE from 'three';
import { SCENE_CONFIG } from './cliffMath';

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
}): LightingSystem {
  const group = new THREE.Group();
  const shadowMapSize = options.isSoftwareGpu ? 1024 : 4096;

  options.scene.fog = new THREE.FogExp2(0x28303b, 0.0052);

  const sunLight = new THREE.DirectionalLight(0xffbc80, 3.35);
  sunLight.position.set(
    SCENE_CONFIG.sunDirection.x * 82,
    SCENE_CONFIG.sunDirection.y * 82 + 12,
    SCENE_CONFIG.sunDirection.z * 82,
  );
  sunLight.target.position.set(0, 7, -11);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sunLight.shadow.camera.near = 14;
  sunLight.shadow.camera.far = 185;
  sunLight.shadow.camera.left = -46;
  sunLight.shadow.camera.right = 46;
  sunLight.shadow.camera.top = 42;
  sunLight.shadow.camera.bottom = -18;
  sunLight.shadow.bias = -0.00035;
  sunLight.shadow.normalBias = 0.04;
  group.add(sunLight);
  group.add(sunLight.target);

  const skyHemisphere = new THREE.HemisphereLight(0x8db2db, 0x1b222a, 1.25);
  group.add(skyHemisphere);

  const valleyBounceLight = new THREE.DirectionalLight(0x7c9ec2, 0.92);
  valleyBounceLight.position.set(36, 22, 48);
  group.add(valleyBounceLight);

  const mistBounceLight = new THREE.PointLight(0xffc692, 9.5, 34, 1.8);
  mistBounceLight.position.set(-4.5, 5.5, -5.2);
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
