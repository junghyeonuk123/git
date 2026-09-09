import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';

const DRIBBLE_HAND_HEIGHT = 0.78; // waist-ish, real dribble height
const MAX_HORIZONTAL_CORRECTION = 8; // m/s cap on the steering set at each bounce
const CATCH_MARGIN = 0.05; // meters above the floor the "bounce" trigger arms within
const BOUNCE_COOLDOWN = 0.2; // seconds, debounces re-triggering while the ball lingers near the floor
const BOUNCE_HEIGHT_FACTOR = 0.92; // rise just short of hand height, like a real catch rather than a wall-bounce overshoot

/**
 * Drives a dribble the way spec section 10 asks for: the ball is never
 * kinematically snapped to the hand. It stays a normal dynamic rigid body
 * the whole time - between touches it is pure gravity, exactly like a real
 * ball in the air.
 *
 * The court's own restitution (see MaterialProperties) is tuned for
 * rebounds off the rim, not a hand-height dribble - left alone, a ball
 * dropped from hand height only rebounds a few centimeters and would sit
 * on the floor while any steering nudged it around, which is what actually
 * looked "dragged" before. So this system supplies the one thing a floor
 * bounce can't: a hand's worth of upward energy. Once per bounce, at the
 * instant the ball is down near the floor, it sets a single velocity -
 * enough vertical speed to rise back to about hand height, plus whatever
 * horizontal speed carries it to the hand's current position by the time
 * it gets there - and then gets out of the way completely until the next
 * one. Everything in between is real ballistic flight.
 */
export class DribbleSystem {
  private cooldown = 0;
  private readonly handPos = new THREE.Vector3();

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly gravity: number,
  ) {}

  fixedUpdate(dt: number, hand: 1 | -1): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0) return;

    const ballPos = this.ball.position;
    const floorY = CD.ball.radius;
    const nearFloor = ballPos.y <= floorY + CATCH_MARGIN && this.ball.body.linvel().y <= 0.5;
    if (!nearFloor) return;

    this.cooldown = BOUNCE_COOLDOWN;
    this.player.getHandPosition(this.handPos, hand, DRIBBLE_HAND_HEIGHT);

    // Vertical speed needed to just reach hand height, i.e. v^2 = 2*g*h.
    const riseHeight = Math.max(0.15, this.handPos.y - floorY) * BOUNCE_HEIGHT_FACTOR;
    const vy = Math.sqrt(2 * this.gravity * riseHeight);
    const tRise = vy / this.gravity; // time from this bounce to reaching that peak

    const dx = this.handPos.x - ballPos.x;
    const dz = this.handPos.z - ballPos.z;
    const vx = THREE.MathUtils.clamp(dx / tRise, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);
    const vz = THREE.MathUtils.clamp(dz / tRise, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);

    this.ball.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  /** Ball position the moment possession is lost/gained, useful for a clean handoff. */
  getHandAnchor(hand: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    return this.player.getHandPosition(out, hand, DRIBBLE_HAND_HEIGHT);
  }
}
