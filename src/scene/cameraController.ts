import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraController {
  readonly update: (input: {
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
  }) => void;
  readonly isDriftEnabled: () => boolean;
  readonly setDriftEnabled: (enabled: boolean) => void;
  readonly resetView: () => void;
  readonly dispose: () => void;
}

const HERO_CAMERA_POSITION = new THREE.Vector3(5.6, 4.7, 21.8);
const HERO_CAMERA_TARGET = new THREE.Vector3(-0.35, 7.6, -1.2);

export function createCameraController(options: {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
}): CameraController {
  options.camera.position.copy(HERO_CAMERA_POSITION);

  const controls = new OrbitControls(options.camera, options.domElement);
  controls.target.copy(HERO_CAMERA_TARGET);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.72;
  controls.minDistance = 10.5;
  controls.maxDistance = 33.0;
  controls.minPolarAngle = Math.PI * 0.24;
  controls.maxPolarAngle = Math.PI * 0.53;
  controls.minAzimuthAngle = -Math.PI * 0.44;
  controls.maxAzimuthAngle = Math.PI * 0.44;
  controls.update();

  let driftEnabled = true;
  let userDragging = false;
  let idleSeconds = 4.0;
  let resetProgress = 1.0;

  const resetStartPos = new THREE.Vector3();
  const resetStartTarget = new THREE.Vector3();
  const sphericalOffset = new THREE.Spherical();
  const offsetVec = new THREE.Vector3();

  const onInteractionStart = () => {
    userDragging = true;
    idleSeconds = 0;
    resetProgress = 1.0;
  };

  const onInteractionEnd = () => {
    userDragging = false;
    idleSeconds = 0;
  };

  controls.addEventListener('start', onInteractionStart);
  controls.addEventListener('end', onInteractionEnd);

  return {
    update: ({ elapsedSeconds, deltaSeconds }) => {
      const clampedDelta = Math.min(deltaSeconds, 0.1);

      if (resetProgress < 1.0) {
        resetProgress = Math.min(1.0, resetProgress + clampedDelta * 1.15);
        const eased = 1 - Math.pow(1 - resetProgress, 3);
        options.camera.position.lerpVectors(resetStartPos, HERO_CAMERA_POSITION, eased);
        controls.target.lerpVectors(resetStartTarget, HERO_CAMERA_TARGET, eased);
      } else if (driftEnabled && !userDragging) {
        idleSeconds += clampedDelta;
        const driftBlend = Math.min(1, Math.max(0, (idleSeconds - 1.5) / 2.5));

        if (driftBlend > 0) {
          offsetVec.copy(options.camera.position).sub(controls.target);
          sphericalOffset.setFromVector3(offsetVec);

          const azimuthVelocity = Math.cos(elapsedSeconds * 0.14) * 0.032 * driftBlend;
          const polarVelocity = Math.sin(elapsedSeconds * 0.19) * 0.009 * driftBlend;

          sphericalOffset.theta = THREE.MathUtils.clamp(
            sphericalOffset.theta + azimuthVelocity * clampedDelta,
            controls.minAzimuthAngle + 0.06,
            controls.maxAzimuthAngle - 0.06,
          );
          sphericalOffset.phi = THREE.MathUtils.clamp(
            sphericalOffset.phi + polarVelocity * clampedDelta,
            controls.minPolarAngle + 0.04,
            controls.maxPolarAngle - 0.04,
          );

          offsetVec.setFromSpherical(sphericalOffset);
          options.camera.position.copy(controls.target).add(offsetVec);
        }
      }

      if (options.camera.position.y < 1.6) {
        options.camera.position.y = 1.6;
      }

      controls.update();
    },
    isDriftEnabled: () => driftEnabled,
    setDriftEnabled: (enabled: boolean) => {
      driftEnabled = enabled;
      if (enabled) {
        idleSeconds = 4.0;
      }
    },
    resetView: () => {
      resetStartPos.copy(options.camera.position);
      resetStartTarget.copy(controls.target);
      resetProgress = 0;
      idleSeconds = 0;
    },
    dispose: () => {
      controls.removeEventListener('start', onInteractionStart);
      controls.removeEventListener('end', onInteractionEnd);
      controls.dispose();
    },
  };
}
