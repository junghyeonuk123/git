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
// player's fastest movement speed (sprint, 6.2 m/s) - a cap below that
// created an unboundedly growing gap during sustained sprinting (not just
// sudden turns): the momentum blend below converges to a stable steady-
// state offset only if the ball's velocity can actually reach the
// player's, and a too-low cap makes that structurally impossible, so the
// shortfall compounds every cycle instead of settling.
const MAX_HORIZONTAL_CORRECTION = 9;
const CATCH_MARGIN = 0.05; // meters above the floor the "bounce" trigger arms within
const BOUNCE_COOLDOWN = 0.2; // seconds, debounces re-triggering while the ball lingers near the floor
const BOUNCE_HEIGHT_FACTOR = 0.92; // rise just short of hand height, like a real catch rather than a wall-bounce overshoot
const MOMENTUM_BLEND = 0.35; // how much of each bounce's new aim comes from the *previous* bounce's velocity vs. a fresh full re-aim
const LEAD_TIME = 0.25; // seconds of player velocity to lead the target by, so a moving dribble sits ahead of the body instead of dead-center under it - also tightens the steady-sprint gap by aiming closer to where the hand will actually be by next bounce

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
 * instant the ball is down near the floor, it sets a single velocity, then
 * gets out of the way completely until the next one - everything in
 * between is real ballistic flight, never touched frame-to-frame.
 *
 * The horizontal aim at each bounce is deliberately NOT "compute the exact
 * velocity that lands precisely on the hand's current position" - that
 * was still every bounce re-homing the ball to a precise live target with
 * no memory of where it was already headed, which is exactly what read as
 * an invisible string tethering it to the hand even though nothing ran
 * every frame. A real dribble's hand chases the ball's actual bounce, not
 * the reverse: the ball's new aim each cycle is blended with its outgoing
 * velocity from the *previous* cycle (MOMENTUM_BLEND), so a sudden change
 * of direction takes a couple of bounces to fully catch up instead of
 * resolving on the very next one, and the target itself leads the
 * player's live velocity a little (LEAD_TIME) so a moving dribble sits
 * ahead of the body instead of homing dead-center under the hand every
 * single time.
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
    if (playerVelocity) {
      this.handPos.x += playerVelocity.x * LEAD_TIME;
      this.handPos.z += playerVelocity.y * LEAD_TIME;
    }

    // Vertical speed needed to just reach hand height, i.e. v^2 = 2*g*h.
    const riseHeight = Math.max(0.15, this.handPos.y - floorY) * BOUNCE_HEIGHT_FACTOR;
    const vy = Math.sqrt(2 * this.gravity * riseHeight);
    const tRise = vy / this.gravity; // time from this bounce to reaching that peak

    const dx = this.handPos.x - ballPos.x;
    const dz = this.handPos.z - ballPos.z;
    const aimVx = THREE.MathUtils.clamp(dx / tRise, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);
    const aimVz = THREE.MathUtils.clamp(dz / tRise, -MAX_HORIZONTAL_CORRECTION, MAX_HORIZONTAL_CORRECTION);

    // Blend with the velocity this same bounce carried in with (not the
    // hand-chasing target from last cycle, the ball's own outgoing speed),
    // so direction changes are gradual instead of resolving in one bounce.
    const vx = THREE.MathUtils.lerp(incomingVel.x, aimVx, 1 - MOMENTUM_BLEND);
    const vz = THREE.MathUtils.lerp(incomingVel.z, aimVz, 1 - MOMENTUM_BLEND);

    this.ball.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  /** Ball position the moment possession is lost/gained, useful for a clean handoff. */
  getHandAnchor(hand: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    return this.player.getHandPosition(out, hand, DRIBBLE_HEIGHT_NORMAL);
  }
}
