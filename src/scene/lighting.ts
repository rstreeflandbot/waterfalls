import * as THREE from 'three';
import { SCENE_CONFIG } from './cliffMath';

export interface LightingSystem {
  readonly group: THREE.Group;
  readonly sunLight: THREE.DirectionalLight;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

export function createIcelandicLighting(scene: THREE.Scene): LightingSystem {
  const group = new THREE.Group();

  scene.fog = new THREE.FogExp2(0x28303b, 0.0056);

  const sunLight = new THREE.DirectionalLight(0xffbe86, 2.95);
  sunLight.position.set(
    SCENE_CONFIG.sunDirection.x * 85,
    SCENE_CONFIG.sunDirection.y * 85 + 14,
    SCENE_CONFIG.sunDirection.z * 85,
  );
  sunLight.target.position.set(0, 6, -12);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 15;
  sunLight.shadow.camera.far = 210;
  sunLight.shadow.camera.left = -56;
  sunLight.shadow.camera.right = 56;
  sunLight.shadow.camera.top = 48;
  sunLight.shadow.camera.bottom = -22;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.045;
  group.add(sunLight);
  group.add(sunLight.target);

  const skyHemisphere = new THREE.HemisphereLight(0x88a8cb, 0x1a2026, 1.15);
  group.add(skyHemisphere);

  const valleyFillLight = new THREE.DirectionalLight(0x7d9fc4, 0.95);
  valleyFillLight.position.set(38, 26, 48);
  group.add(valleyFillLight);

  const mistBounceLight = new THREE.PointLight(0xffc998, 8.5, 36, 1.8);
  mistBounceLight.position.set(-4.0, 5.2, -5.5);
  group.add(mistBounceLight);

  return {
    group,
    sunLight,
    update: (elapsedSeconds: number) => {
      mistBounceLight.intensity = 8.2 + Math.sin(elapsedSeconds * 1.2) * 0.8;
    },
    dispose: () => {
      sunLight.shadow.map?.dispose();
    },
  };
}
