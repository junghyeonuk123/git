import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';
import { DribblePhysicsConfig as CFG } from './DribblePhysicsConfig';

// Gameplay-systems spec section 5: dribble height responds to movement
// state instead of being one fixed pocket - low/tight while sprinting
// (ball security over control), high/relaxed while set in triple threat,
// normal in between. PlayerController picks which of these to pass in
// each step based on PlayerStateMachine's current state. Re-exported here
// (sourced from DribblePhysicsConfig.ts, spec section 53) so existing
// importers don't need to change.
export const DRIBBLE_HEIGHT_LOW = CFG.dribbleHeightLow;
export const DRIBBLE_HEIGHT_NORMAL = CFG.dribbleHeightNormal;
export const DRIBBLE_HEIGHT_HIGH = CFG.dribbleHeightHigh;

/** Spec section 36/41: which part of the bounce cycle the ball is in this instant, for debug visibility only - never used to gate physics. */
export type DribblePhase = 'flight' | 'contact';

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
 * movementInfluence blend in DribblePhysicsConfig only guards the one
 * genuine edge case (an instantaneous full-speed input reversal) without
 * reintroducing lag.
 *
 * This is also already the "hand follows ball, not ball follows hand"
 * shape spec section 14 asks for: Player.pointArmAtBall (called from
 * Game.ts every render frame) points the dribbling arm at the ball's
 * actual physics position, it never writes to the ball. The only place
 * the ball's transform is set is fixedUpdate below (once per bounce, a
 * velocity, not a position) and Ball.setKinematicHeld/release (gather and
 * loose-ball grab handoffs) - there is exactly one authoritative writer
 * of the ball transform at any moment, matching spec section 52.
 */
export class DribbleSystem {
  private cooldown = 0;
  private readonly handPos = new THREE.Vector3();

  /** Debug/instrumentation only (spec section 41) - never read by the physics itself. */
  private debugPhase: DribblePhase = 'flight';
  private debugContactTimer = 0;
  private debugHandDistance = 0;

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly gravity: number,
  ) {}

  fixedUpdate(dt: number, hand: 1 | -1, height: number = DRIBBLE_HEIGHT_NORMAL, playerVelocity?: THREE.Vector2): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.debugContactTimer += dt;
    this.player.getHandPosition(this.handPos, hand, height);
    this.debugHandDistance = this.ball.position.distanceTo(this.handPos);
    if (this.cooldown > 0) {
      this.debugPhase = 'flight';
      return;
    }

    const ballPos = this.ball.position;
    const floorY = CD.ball.radius;
    const incomingVel = this.ball.body.linvel();
    const nearFloor = ballPos.y <= floorY + CFG.contactTolerance && incomingVel.y <= 0.5;
    if (!nearFloor) {
      this.debugPhase = 'flight';
      return;
    }

    this.debugPhase = 'contact';
    this.debugContactTimer = 0;
    this.cooldown = CFG.bounceCooldown;
    // handPos already computed above at the top of this step

    // Vertical speed needed to just reach hand height, i.e. v^2 = 2*g*h.
    const riseHeight = Math.max(0.15, this.handPos.y - floorY) * CFG.bounceHeightFactor;
    const vy = Math.sqrt(2 * this.gravity * riseHeight);
    const tRise = vy / this.gravity; // time from this bounce to reaching that peak

    // A dribble's horizontal motion is "the ball travels along with me",
    // NOT "the ball flies to wherever my hand is". Those are the same
    // thing while running in a straight line, but they diverge hard the
    // moment the player cuts: solving for "arrive exactly at the hand"
    // demanded whatever velocity that took - up to the old 9 m/s cap -
    // so on a direction change the ball got flung sideways after the
    // player. That is exactly the "ball on a string being dragged
    // around" look, and no amount of retuning the old formula fixes it,
    // because chasing the hand IS the formula.
    //
    // So the two parts are now separated and only the second one is
    // capped: the ball inherits the player's own velocity (that is the
    // hand carrying it along), plus a deliberately small convergence
    // term that nudges it back under the hand over the next bounce or
    // two. Cut hard and the ball genuinely falls behind for a beat and
    // has to be recovered - which is what real dribbling looks like.
    const playerVx = playerVelocity?.x ?? 0;
    const playerVz = playerVelocity?.y ?? 0;
    const correctionX = THREE.MathUtils.clamp(
      (this.handPos.x - ballPos.x) / tRise,
      -CFG.maxHandConvergence,
      CFG.maxHandConvergence,
    );
    const correctionZ = THREE.MathUtils.clamp(
      (this.handPos.z - ballPos.z) / tRise,
      -CFG.maxHandConvergence,
      CFG.maxHandConvergence,
    );

    const vx = THREE.MathUtils.lerp(incomingVel.x, playerVx + correctionX, 1 - CFG.movementInfluence);
    const vz = THREE.MathUtils.lerp(incomingVel.z, playerVz + correctionZ, 1 - CFG.movementInfluence);

    this.ball.body.setLinvel({ x: vx, y: vy, z: vz }, true);
  }

  /** Ball position the moment possession is lost/gained, useful for a clean handoff. */
  getHandAnchor(hand: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    return this.player.getHandPosition(out, hand, DRIBBLE_HEIGHT_NORMAL);
  }

  /** Spec section 41's debug panel fields - read-only, purely for the F8/F1 debug overlay. */
  get phase(): DribblePhase {
    return this.debugPhase;
  }

  /** Seconds since the last floor contact (bounce). */
  get contactTimer(): number {
    return this.debugContactTimer;
  }

  /** Current distance between the ball and the dribbling hand's target anchor. */
  get handDistance(): number {
    return this.debugHandDistance;
  }
}
