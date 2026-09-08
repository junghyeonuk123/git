import * as THREE from 'three';
import { damp } from '@/utils/MathUtils';

export interface CameraControllerConfig {
  distance: number;
  height: number;
  lookAtHeight: number;
  positionLambda: number; // higher = snappier follow
  rotationLambda: number;
  fov: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraControllerConfig = {
  distance: 6.5,
  height: 3.2,
  lookAtHeight: 1.3,
  positionLambda: 6,
  rotationLambda: 8,
  fov: 55,
};

/**
 * Phase 1 gameplay camera: smoothly damped third-person follow, orbiting
 * behind the player's facing direction. This is intentionally the only
 * camera mode for now - BroadcastCamera/ReplayCamera/CinematicCamera
 * (spec sections 20-22) come later behind the same CameraManager
 * interface once there is an event bus and multiple modes worth
 * switching between.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;

  private readonly currentPosition = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private initialized = false;

  constructor(
    aspect: number,
    private config: CameraControllerConfig = DEFAULT_CAMERA_CONFIG,
  ) {
    this.camera = new THREE.PerspectiveCamera(config.fov, aspect, 0.1, 200);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Call once per rendered frame (not per fixed step) with the player's current facing/position. */
  update(playerPosition: THREE.Vector3, playerFacingYaw: number, dt: number): void {
    // orbit the camera to sit behind the player's facing direction
    this.yaw = playerFacingYaw;

    const desired = new THREE.Vector3(
      playerPosition.x - Math.sin(this.yaw) * this.config.distance,
      playerPosition.y + this.config.height,
      playerPosition.z - Math.cos(this.yaw) * this.config.distance,
    );
    const target = new THREE.Vector3(playerPosition.x, playerPosition.y + this.config.lookAtHeight, playerPosition.z);

    if (!this.initialized) {
      this.currentPosition.copy(desired);
      this.currentTarget.copy(target);
      this.initialized = true;
    } else {
      this.currentPosition.x = damp(this.currentPosition.x, desired.x, this.config.positionLambda, dt);
      this.currentPosition.y = damp(this.currentPosition.y, desired.y, this.config.positionLambda, dt);
      this.currentPosition.z = damp(this.currentPosition.z, desired.z, this.config.positionLambda, dt);
      this.currentTarget.x = damp(this.currentTarget.x, target.x, this.config.rotationLambda, dt);
      this.currentTarget.y = damp(this.currentTarget.y, target.y, this.config.rotationLambda, dt);
      this.currentTarget.z = damp(this.currentTarget.z, target.z, this.config.rotationLambda, dt);
    }

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentTarget);
  }
}
