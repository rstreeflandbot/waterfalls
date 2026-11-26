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

  scene.fog = new THREE.FogExp2(0x1f252e, 0.0145);

  const sunLight = new THREE.DirectionalLight(0xffb578, 3.6);
  sunLight.position.set(
    SCENE_CONFIG.sunDirection.x * 55,
    SCENE_CONFIG.sunDirection.y * 55 + 6,
    SCENE_CONFIG.sunDirection.z * 55,
  );
  sunLight.target.position.set(0, 6, 0);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 120;
  sunLight.shadow.camera.left = -30;
  sunLight.shadow.camera.right = 30;
  sunLight.shadow.camera.top = 34;
  sunLight.shadow.camera.bottom = -12;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.04;
  group.add(sunLight);
  group.add(sunLight.target);

  const skyHemisphere = new THREE.HemisphereLight(0x7d97b8, 0x161b20, 1.05);
  group.add(skyHemisphere);

  const canyonRimLight = new THREE.DirectionalLight(0x6e8fb5, 0.85);
  canyonRimLight.position.set(24, 18, 28);
  group.add(canyonRimLight);

  const mistBounceLight = new THREE.PointLight(0xffbe88, 18, 34, 1.7);
  mistBounceLight.position.set(-2.5, 4.8, 5.2);
  group.add(mistBounceLight);

  const grottoFillLight = new THREE.PointLight(0x6b90ad, 8, 24, 1.8);
  grottoFillLight.position.set(0, 6.5, -1.5);
  group.add(grottoFillLight);

  return {
    group,
    sunLight,
    update: (elapsedSeconds: number) => {
      mistBounceLight.intensity = 17.0 + Math.sin(elapsedSeconds * 1.4) * 1.6;
    },
    dispose: () => {
      sunLight.shadow.map?.dispose();
    },
  };
}
