import * as THREE from 'three';
import { clamp } from '@/utils/MathUtils';

export interface PlayerMovementConfig {
  walkSpeed: number; // m/s
  sprintSpeed: number;
  acceleration: number; // m/s^2 while input is held
  deceleration: number; // m/s^2 while no input (or opposing input)
  turnLambda: number; // facing-rotation damping rate
}

export const DEFAULT_MOVEMENT_CONFIG: PlayerMovementConfig = {
  walkSpeed: 3.2,
  sprintSpeed: 6.2,
  acceleration: 22,
  deceleration: 28,
  turnLambda: 14,
};

/**
 * Pure velocity model: acceleration towards a target speed/direction and
 * deceleration back to zero, so starting/stopping/turning never looks
 * like an instant teleport-style velocity snap (spec section 17).
 * Has no Rapier/Three dependency beyond Vector3 so it's easy to reason
 * about and unit-test in isolation from the physics world.
 */
export class PlayerMovement {
  readonly velocity = new THREE.Vector2(0, 0); // world-space X/Z
  facingYaw = 0;
  /** Multiplies max speed this step; dribble moves (see DribbleMoves.ts) drive this for freeze/burst beats. */
  speedScale = 1;

  constructor(private readonly config: PlayerMovementConfig = DEFAULT_MOVEMENT_CONFIG) {}

  /** Adds directly to current velocity - a one-shot juke/dash impulse, not a per-frame force. */
  applyImpulse(delta: THREE.Vector2): void {
    this.velocity.add(delta);
  }

  /**
   * @param inputAxis normalized {x: strafe, y: forward} in [-1,1]
   * @param sprint whether the sprint modifier is held
   * @param dt fixed physics timestep seconds
   * @returns world-space horizontal displacement for this step
   *
   * Movement is world-relative, matching the fixed broadcast camera
   * (CameraController never rotates - see spec section 21). The camera
   * sits on the -Z sideline looking toward +Z, which makes its
   * screen-right vector world -X (right = forward x up = (0,0,1)x(0,1,0)
   * = (-1,0,0)) - so "move right" has to negate input.x, not pass it
   * through, or D would visibly walk the character left.
   */
  step(inputAxis: { x: number; y: number }, sprint: boolean, dt: number): THREE.Vector2 {
    const hasInput = inputAxis.x !== 0 || inputAxis.y !== 0;
    const maxSpeed = (sprint ? this.config.sprintSpeed : this.config.walkSpeed) * this.speedScale;
    const targetVx = hasInput ? -inputAxis.x * maxSpeed : 0;
    const targetVz = hasInput ? inputAxis.y * maxSpeed : 0;
    return this.applyTarget(targetVx, targetVz, hasInput, dt);
  }

  /**
   * AI-facing counterpart to step(): steers directly toward an
   * already-world-space direction (defender AI computes "which way is
   * toward my guarding spot" itself, so there's no keyboard input axis
   * to convert - see step()'s doc comment for why that conversion
   * exists at all). Shares the same acceleration/deceleration/turn-damp
   * model so an AI-controlled player moves with the identical feel as
   * the human-controlled one.
   */
  steerToward(direction: THREE.Vector2, sprint: boolean, dt: number): THREE.Vector2 {
    const hasInput = direction.lengthSq() > 1e-6;
    const maxSpeed = (sprint ? this.config.sprintSpeed : this.config.walkSpeed) * this.speedScale;
    const targetVx = hasInput ? direction.x * maxSpeed : 0;
    const targetVz = hasInput ? direction.y * maxSpeed : 0;
    return this.applyTarget(targetVx, targetVz, hasInput, dt);
  }

  private applyTarget(targetVx: number, targetVz: number, hasInput: boolean, dt: number): THREE.Vector2 {
    const rate = hasInput ? this.config.acceleration : this.config.deceleration;
    const t = clamp(rate * dt, 0, 1);
    this.velocity.x += (targetVx - this.velocity.x) * t;
    this.velocity.y += (targetVz - this.velocity.y) * t; // .y stores world Z

    if (hasInput) {
      const targetYaw = Math.atan2(targetVx, targetVz);
      this.facingYaw = dampAngle(this.facingYaw, targetYaw, this.config.turnLambda, dt);
    }

    return new THREE.Vector2(this.velocity.x * dt, this.velocity.y * dt);
  }

  get speed(): number {
    return this.velocity.length();
  }
}

/** Shortest-path angular damping, shared with anything else that needs to turn a player smoothly (e.g. squaring up to the rim for a shot). */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = target - current;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta)); // shortest angular path
  const t = 1 - Math.exp(-lambda * dt);
  return current + delta * t;
}
