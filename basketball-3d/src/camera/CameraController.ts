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
  sprintSpeed: number; // player speed (m/s) at which the dynamic FOV/pull-back reaches full strength
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
  sprintSpeed: 6.2,
};

/** Per-frame gameplay context the camera reacts to (spec sections 24/25: contextual, never disorienting). */
export interface CameraContext {
  /** Player's current horizontal speed in m/s - drives a subtle dynamic FOV/pull-back at sprint. */
  speed: number;
  /** True while a shot is being charged - narrows the frame slightly and biases it toward the target hoop. */
  charging: boolean;
  /** World X of the hoop being aimed at, only meaningful while `charging` is true. */
  chargeFocusX: number | null;
}

const FOV_SPEED_BOOST = 5; // degrees of extra FOV at full sprint - sells speed without moving the camera
const FOV_CHARGE_NARROW = 3; // degrees narrower while lining up a shot - a gentle "focus" cue
const DISTANCE_SPEED_PULLBACK = 2.2; // meters pulled back at full sprint, keeping fast movement framed
const CHARGE_FOCUS_BLEND = 0.3; // how strongly the shot target hoop pulls the framing while charging
const FOV_LAMBDA = 4;
const DISTANCE_LAMBDA = 3;

/**
 * A fixed broadcast-style sideline camera (spec section 21): it never
 * orbits or rotates to match a player's facing direction - it sits at a
 * constant position off one sideline, the way a real TV camera is bolted
 * in place, and only pans/tilts to keep the play framed. This is the
 * direct fix for the disorienting spin a facing-locked orbit camera
 * produced whenever the player turned. Movement input is correspondingly
 * world-relative now (see PlayerController), not camera-relative, since
 * there is no longer a rotating camera yaw to be relative to.
 *
 * "Dynamic" framing (spec sections 24/25) is layered on top without ever
 * touching rotation or doing a hard cut: FOV widens and the camera pulls
 * back a little at sprint speed (sells motion the same way a real
 * broadcast lens racking wider does), and narrows/biases toward the
 * target hoop while a shot is charging. Both are exponentially damped
 * like the existing pan/look tracking, so nothing snaps.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;

  private currentX = 0;
  private lookX = 0;
  private lookZ = 0;
  private currentFov: number;
  private currentDistance: number;
  private initialized = false;

  constructor(
    aspect: number,
    private config: CameraControllerConfig = DEFAULT_CAMERA_CONFIG,
  ) {
    this.camera = new THREE.PerspectiveCamera(config.fov, aspect, 0.1, 200);
    this.currentFov = config.fov;
    this.currentDistance = config.sidelineDistance;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Call once per rendered frame with the play's current focal points and context. */
  update(playerPosition: THREE.Vector3, ballPosition: THREE.Vector3, dt: number, context: CameraContext): void {
    let focusX = THREE.MathUtils.lerp(playerPosition.x, ballPosition.x, this.config.ballInfluence);
    const focusZ = THREE.MathUtils.lerp(playerPosition.z, ballPosition.z, this.config.ballInfluence);
    if (context.charging && context.chargeFocusX !== null) {
      focusX = THREE.MathUtils.lerp(focusX, context.chargeFocusX, CHARGE_FOCUS_BLEND);
    }
    const targetX = clamp(focusX, -this.config.panRange, this.config.panRange);

    const speedT = clamp(context.speed / this.config.sprintSpeed, 0, 1);
    let targetFov = this.config.fov + FOV_SPEED_BOOST * speedT;
    if (context.charging) targetFov -= FOV_CHARGE_NARROW;
    const targetDistance = this.config.sidelineDistance + DISTANCE_SPEED_PULLBACK * speedT;

    if (!this.initialized) {
      this.currentX = targetX;
      this.lookX = focusX;
      this.lookZ = focusZ;
      this.currentFov = targetFov;
      this.currentDistance = targetDistance;
      this.initialized = true;
    } else {
      this.currentX = damp(this.currentX, targetX, this.config.panLambda, dt);
      this.lookX = damp(this.lookX, focusX, this.config.lookLambda, dt);
      this.lookZ = damp(this.lookZ, focusZ, this.config.lookLambda, dt);
      this.currentFov = damp(this.currentFov, targetFov, FOV_LAMBDA, dt);
      this.currentDistance = damp(this.currentDistance, targetDistance, DISTANCE_LAMBDA, dt);
    }

    if (Math.abs(this.camera.fov - this.currentFov) > 1e-3) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.set(this.currentX * 0.6, this.config.height, -this.currentDistance);
    this.camera.lookAt(this.lookX, this.config.lookAtHeight, this.lookZ);
  }
}
