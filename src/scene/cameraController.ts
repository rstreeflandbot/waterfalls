import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Vec3Tuple } from './cliffMath';

export interface CameraController {
  readonly update: (input: {
    readonly elapsedSeconds: number;
    readonly deltaSeconds: number;
  }) => void;
  readonly setHeroPose: (pose: {
    readonly position: Vec3Tuple;
    readonly target: Vec3Tuple;
    readonly immediate: boolean;
  }) => void;
  readonly isDriftEnabled: () => boolean;
  readonly setDriftEnabled: (enabled: boolean) => void;
  readonly resetView: () => void;
  readonly dispose: () => void;
}

export function createCameraController(options: {
  readonly camera: THREE.PerspectiveCamera;
  readonly domElement: HTMLElement;
  readonly initialPosition: Vec3Tuple;
  readonly initialTarget: Vec3Tuple;
}): CameraController {
  const heroPosition = new THREE.Vector3(
    options.initialPosition.x,
    options.initialPosition.y,
    options.initialPosition.z,
  );
  const heroTarget = new THREE.Vector3(
    options.initialTarget.x,
    options.initialTarget.y,
    options.initialTarget.z,
  );

  options.camera.position.copy(heroPosition);

  const controls = new OrbitControls(options.camera, options.domElement);
  controls.target.copy(heroTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.045;
  controls.enablePan = false;
  controls.rotateSpeed = 0.56;
  controls.zoomSpeed = 0.78;
  controls.minDistance = 14.0;
  controls.maxDistance = 64.0;
  controls.minPolarAngle = Math.PI * 0.14;
  controls.maxPolarAngle = Math.PI * 0.52;
  controls.minAzimuthAngle = -Math.PI * 0.76;
  controls.maxAzimuthAngle = Math.PI * 0.76;
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
        options.camera.position.lerpVectors(resetStartPos, heroPosition, eased);
        controls.target.lerpVectors(resetStartTarget, heroTarget, eased);
      } else if (driftEnabled && !userDragging) {
        idleSeconds += clampedDelta;
        const driftBlend = Math.min(1, Math.max(0, (idleSeconds - 1.5) / 2.5));

        if (driftBlend > 0) {
          offsetVec.copy(options.camera.position).sub(controls.target);
          sphericalOffset.setFromVector3(offsetVec);

          const azimuthVelocity = Math.cos(elapsedSeconds * 0.11) * 0.026 * driftBlend;
          const polarVelocity = Math.sin(elapsedSeconds * 0.16) * 0.006 * driftBlend;

          sphericalOffset.theta = THREE.MathUtils.clamp(
            sphericalOffset.theta + azimuthVelocity * clampedDelta,
            controls.minAzimuthAngle + 0.08,
            controls.maxAzimuthAngle - 0.08,
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

      if (options.camera.position.y < 1.9) {
        options.camera.position.y = 1.9;
      }

      controls.update();
    },
    setHeroPose: (pose) => {
      heroPosition.set(pose.position.x, pose.position.y, pose.position.z);
      heroTarget.set(pose.target.x, pose.target.y, pose.target.z);
      if (pose.immediate) {
        options.camera.position.copy(heroPosition);
        controls.target.copy(heroTarget);
        resetProgress = 1.0;
        controls.update();
      } else {
        resetStartPos.copy(options.camera.position);
        resetStartTarget.copy(controls.target);
        resetProgress = 0;
        idleSeconds = 0;
      }
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
