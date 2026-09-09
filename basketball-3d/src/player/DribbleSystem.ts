import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';

// Gameplay-systems spec section 5: dribble height responds to movement
// state instead of being one fixed pocket - low/tight while sprinting
// (ball security over control), high/relaxed while set in triple threat,
// normal in between. PlayerController picks which of these to pass in
// each step based on PlayerStateMachine's current state.
export const DRIBBLE_HEIGHT_LOW = 0.6; // sprint dribble
export const DRIBBLE_HEIGHT_NORMAL = 0.78; // walking/standard dribble
export const DRIBBLE_HEIGHT_HIGH = 0.88; // triple-threat, more control

// m/s cap on the steering set at each bounce. Must comfortably exceed the
// player's fastest movement speed (sprint, 6.2 m/s) or the ball becomes
// structurally unable to keep pace while sprinting, and the gap grows
// without bound instead of tracking the player.
const MAX_HORIZONTAL_CORRECTION = 9;
const CATCH_MARGIN = 0.05; // meters above the floor the "bounce" trigger arms within
const BOUNCE_COOLDOWN = 0.2; // seconds, debounces re-triggering while the ball lingers near the floor
const BOUNCE_HEIGHT_FACTOR = 0.92; // rise just short of hand height, like a real catch rather than a wall-bounce overshoot
// A small amount of smoothing against the ball's own incoming velocity,
// just enough to avoid a single-bounce infinite-jerk edge case on a
// literal instant 180-degree input reversal - NOT enough to make the ball
// visibly trail the player during ordinary movement. A real dribbler
// keeps the ball with them while walking/running by continuously
// adjusting where they push it next; that's what the tRise-based lead
// below is for, and it does almost all of the work here.
const MOMENTUM_BLEND = 0.08;

/**
 * Drives a dribble the way spec section 10 asks for: the ball is never
 * kinematically snapped to the hand. It stays a normal dynamic rigid body
 * the whole time - between touches it is pure gravity, exactly like a real
 * ball in the air. Once per bounce, at the instant the ball is down near
 * the floor, it sets a single velocity, then gets out of the way
 * completely until the next one - everything in between is real
 * ballistic flight, never touched frame-to-frame, so the ball still
 * visibly leaves the hand and comes back rather than being glued to a
 * fixed offset.
 *
 * The horizontal aim leads the player's live velocity by exactly this
 * bounce's own rise time (tRise) - "predict where the hand will actually
 * be by the moment the ball gets there," not "aim at where the hand is
 * right now." That match matters: aiming at the hand's *current* spot
 * while the player keeps moving means the ball is chronically behind by
 * construction (it's always solving last moment's problem), which reads
 * as the ball dragging behind the player during ordinary back-and-forth
 * movement - exactly wrong, since a real dribbler keeps the ball with
 * them the whole time they're moving. Leading by tRise keeps the two in
 * sync through normal movement and direction changes alike; the small
 * MOMENTUM_BLEND above only guards the one genuine edge case (an
 * instantaneous full-speed input reversal) without reintroducing lag.
 */
export class DribbleSystem {
  private cooldown = 0;
  private readonly handPos = new THREE.Vector3();

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly gravity: number,
  ) {}

  fixedUpdate(dt: number, hand: 1 | -1, height: number = DRIBBLE_HEIGHT_NORMAL, playerVelocity?: THREE.Vector2): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0) return;

    const ballPos = this.ball.position;
    const floorY = CD.ball.radius;
    const incomingVel = this.ball.body.linvel();
    const nearFloor = ballPos.y <= floorY + CATCH_MARGIN && incomingVel.y <= 0.5;
    if (!nearFloor) return;

    this.cooldown = BOUNCE_COOLDOWN;
    this.player.getHandPosition(this.handPos, hand, height);

    // Vertical speed needed to just reach hand height, i.e. v^2 = 2*g*h.
    const riseHeight = Math.max(0.15, this.handPos.y - floorY) * BOUNCE_HEIGHT_FACTOR;
    const vy = Math.sqrt(2 * this.gravity * riseHeight);
    const tRise = vy / this.gravity; // time from this bounce to reaching that peak

    if (playerVelocity) {
      this.handPos.x += playerVelocity.x * tRise;
      this.handPos.z += playerVelocity.y * tRise;
    }

    const dx = this.handPos.x - ballPos.x;
    const dz = this.handPos.z - ballPos.z;
    const aimVx = THREE.MathUtils.clamp(dx / tRise, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);
    const aimVz = THREE.MathUtils.clamp(dz / tRise, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);

    const vx = THREE.MathUtils.lerp(incomingVel.x, aimVx, 1 - MOMENTUM_BLEND);
    const vz = THREE.MathUtils.lerp(incomingVel.z, aimVz, 1 - MOMENTUM_BLEND);

    this.ball.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  /** Ball position the moment possession is lost/gained, useful for a clean handoff. */
  getHandAnchor(hand: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    return this.player.getHandPosition(out, hand, DRIBBLE_HEIGHT_NORMAL);
  }
}
