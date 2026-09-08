import * as THREE from 'three';
import { damp, clamp } from '@/utils/MathUtils';

export interface CameraControllerConfig {
  sidelineDistance: number; // fixed distance from the court's centerline (Z=0)
  height: number;
  lookAtHeight: number;
  panRange: number; // how far along the court's length the camera is allowed to pan
  panLambda: number; // higher = snappier pan tracking
  lookLambda: number;
  ballInfluence: number; // 0..1, how much the ball (vs. the player alone) pulls the framing
  fov: number;
}

export const DEFAULT_CAMERA_CONFIG: CameraControllerConfig = {
  sidelineDistance: 17,
  height: 8,
  lookAtHeight: 1.3,
  panRange: 13,
  panLambda: 2.2,
  lookLambda: 3.5,
  ballInfluence: 0.3,
  fov: 42,
};

/**
 * A fixed broadcast-style sideline camera (spec section 21): it never
 * orbits or rotates to match a player's facing direction - it sits at a
 * constant position off one sideline, the way a real TV camera is bolted
 * in place, and only pans/tilts to keep the play framed. This is the
 * direct fix for the disorienting spin a facing-locked orbit camera
 * produced whenever the player turned. Movement input is correspondingly
 * world-relative now (see PlayerController), not camera-relative, since
 * there is no longer a rotating camera yaw to be relative to.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;

  private currentX = 0;
  private lookX = 0;
  private lookZ = 0;
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

  /** Call once per rendered frame with the play's current focal points. */
  update(playerPosition: THREE.Vector3, ballPosition: THREE.Vector3, dt: number): void {
    const focusX = THREE.MathUtils.lerp(playerPosition.x, ballPosition.x, this.config.ballInfluence);
    const focusZ = THREE.MathUtils.lerp(playerPosition.z, ballPosition.z, this.config.ballInfluence);
    const targetX = clamp(focusX, -this.config.panRange, this.config.panRange);

    if (!this.initialized) {
      this.currentX = targetX;
      this.lookX = focusX;
      this.lookZ = focusZ;
      this.initialized = true;
    } else {
      this.currentX = damp(this.currentX, targetX, this.config.panLambda, dt);
      this.lookX = damp(this.lookX, focusX, this.config.lookLambda, dt);
      this.lookZ = damp(this.lookZ, focusZ, this.config.lookLambda, dt);
    }

    this.camera.position.set(this.currentX * 0.6, this.config.height, -this.config.sidelineDistance);
    this.camera.lookAt(this.lookX, this.config.lookAtHeight, this.lookZ);
  }
}
