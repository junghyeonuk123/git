import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';

const DRIBBLE_HAND_HEIGHT = 0.78; // waist-ish, real dribble height
const HORIZONTAL_SPRING = 18; // how hard the ball is steered back under the hand
const MAX_HORIZONTAL_CORRECTION = 8; // m/s cap - must exceed sprint speed or the ball visibly lags behind
const PUSH_SPEED = 4.4; // m/s downward impulse of each dribble "push"
const PUSH_COOLDOWN = 0.12; // seconds, debounces re-triggering while hovering near the push height

/**
 * Drives a dribble the way spec section 10 asks for: the ball is never
 * kinematically snapped to the hand. It stays a normal dynamic rigid
 * body the whole time - gravity and the court's restitution/friction
 * (see MaterialProperties) are what actually produce the bounce. This
 * system only does what a real hand does: nudge the ball back under
 * itself horizontally, and push it back down once per bounce near the
 * top of its arc. Losing possession (see PlayerController) just means
 * this stops being called - the ball keeps whatever velocity real
 * physics already gave it.
 */
export class DribbleSystem {
  private pushCooldown = 0;
  private readonly handPos = new THREE.Vector3();

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
  ) {}

  fixedUpdate(dt: number, hand: 1 | -1): void {
    this.pushCooldown = Math.max(0, this.pushCooldown - dt);

    this.player.getHandPosition(this.handPos, hand, DRIBBLE_HAND_HEIGHT);
    const ballPos = this.ball.position;
    const vel = this.ball.body.linvel();

    const dx = this.handPos.x - ballPos.x;
    const dz = this.handPos.z - ballPos.z;
    const correctionX = THREE.MathUtils.clamp(dx * HORIZONTAL_SPRING, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);
    const correctionZ = THREE.MathUtils.clamp(dz * HORIZONTAL_SPRING, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);

    let vy = vel.y;
    const nearApex = ballPos.y >= this.handPos.y - 0.08 && vel.y <= 0.6;
    if (nearApex && this.pushCooldown <= 0) {
      vy = -PUSH_SPEED;
      this.pushCooldown = PUSH_COOLDOWN;
    }

    this.ball.body.setLinvel({ x: vel.x + correctionX * dt, y: vy, z: vel.z + correctionZ * dt }, true);
  }

  /** Ball position the moment possession is lost/gained, useful for a clean handoff. */
  getHandAnchor(hand: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    return this.player.getHandPosition(out, hand, DRIBBLE_HAND_HEIGHT);
  }
}
