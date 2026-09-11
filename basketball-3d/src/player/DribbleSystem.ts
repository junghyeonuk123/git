import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';
import { DribblePhysicsConfig as CFG } from './DribblePhysicsConfig';

// Re-exported (sourced from DribblePhysicsConfig.ts) so existing
// importers don't need to change.
export const DRIBBLE_HEIGHT_LOW = CFG.dribbleHeightLow;
export const DRIBBLE_HEIGHT_NORMAL = CFG.dribbleHeightNormal;
export const DRIBBLE_HEIGHT_HIGH = CFG.dribbleHeightHigh;

const ZERO_VELOCITY = new THREE.Vector2(0, 0);

/** Which part of the cycle the ball is in this instant, for the debug overlay only - never used to gate physics. */
export type DribblePhase = 'flight' | 'contact';

/**
 * A dribble driven the only way that actually looks like one: the ball
 * is ordinary rigid-body physics, and the single thing this class ever
 * does is push it downward when the hand meets it.
 *
 * WHAT THIS REPLACED, AND WHY IT HAD TO GO
 *
 * Every previous version set the ball's velocity at the FLOOR, aimed at
 * where the hand was or would be. That is backwards, and no amount of
 * retuning could fix it, because the error is structural: at the moment
 * of a floor contact the ball is a meter or so away from the hand, so
 * "arrive at the hand" always demands a large sideways velocity, and the
 * floor ends up silently steering the ball toward the player. From the
 * outside that reads exactly as reported - a ball on a string, or a pet
 * trotting along after the player - because it is: the ball was being
 * corrected toward the player twice a second by something that is not
 * the player.
 *
 * The mechanism now matches the real thing:
 *
 *   - The floor is not touched AT ALL. A bounce is Rapier resolving a
 *     collision between the ball and the court with their real
 *     restitution and friction, the same as any other collision in the
 *     game. Nothing steers there, so nothing can drag the ball around.
 *
 *   - The hand is the only point of control, and it only has control
 *     when it can actually reach the ball (CFG.handReach). One push per
 *     cycle sets the downward speed and hands the ball the player's own
 *     velocity, plus a small recentering nudge.
 *
 * Everything that used to be faked then falls out on its own. Cut hard
 * and the ball keeps the velocity it was last given and genuinely
 * separates, because nothing is reaching out to retrieve it - the player
 * has to get their hand back over it, or lose it (CFG.loseDistance).
 * Push while standing still and it goes straight up and down. The ball
 * is never "attached" to anything, at any point, at any offset.
 *
 * Hand-follows-ball still holds visually: Player.updateDribbleArm points
 * the arm at the ball's real position every frame and never writes to
 * it. The only writer of the ball's velocity here is the push below.
 */
export class DribbleSystem {
  private pushCooldown = 0;
  private prevTargetVx = 0;
  private prevTargetVz = 0;
  private cutArmed = 0;
  private readonly handPos = new THREE.Vector3();
  private readonly predictedHand = new THREE.Vector3();

  /** Debug/instrumentation only - never read by the physics itself. */
  private debugPhase: DribblePhase = 'flight';
  private debugContactTimer = 0;
  private debugHandDistance = 0;
  private debugPushSpeed = 0;

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly gravity: number,
  ) {}

  /**
   * @returns true if the ball has gotten too far away to still count as
   * being dribbled - the caller turns that into a live loose ball.
   */
  fixedUpdate(
    dt: number,
    hand: 1 | -1,
    height: number = DRIBBLE_HEIGHT_NORMAL,
    playerVelocity?: THREE.Vector2,
  ): boolean {
    this.pushCooldown = Math.max(0, this.pushCooldown - dt);
    this.cutArmed = Math.max(0, this.cutArmed - dt);
    this.debugContactTimer += dt;
    this.player.getHandPosition(this.handPos, hand, height);

    const ballPos = this.ball.position;
    const floorY = CD.ball.radius;
    const gapX = this.handPos.x - ballPos.x;
    const gapZ = this.handPos.z - ballPos.z;
    const gap = Math.hypot(gapX, gapZ);
    this.debugHandDistance = gap;
    this.debugPhase = 'flight';

    if (gap > CFG.loseDistance) return true;

    // Starting a cut is itself a reason to put a hand on the ball, so it
    // overrides the bounce's own rhythm (see CFG.cutPushThreshold). What
    // it can never override is whether the hand can physically get to
    // the ball - that check is below and applies either way.
    const travelVx = playerVelocity?.x ?? 0;
    const travelVz = playerVelocity?.y ?? 0;
    if (Math.hypot(travelVx - this.prevTargetVx, travelVz - this.prevTargetVz) > CFG.cutPushThreshold) {
      this.cutArmed = CFG.cutPushWindow;
    }
    this.prevTargetVx = travelVx;
    this.prevTargetVz = travelVz;
    const cutting = this.cutArmed > 0;

    const vel = this.ball.body.linvel();
    const stillRising = vel.y > CFG.apexWindow;
    const abovePocket = ballPos.y > this.handPos.y + CFG.pocketWindow;
    const tooLow = ballPos.y < floorY + CFG.minPushHeight;
    const outOfReach = gap > CFG.handReach;
    if (tooLow || outOfReach) return false;
    if (!cutting && (this.pushCooldown > 0 || stillRising || abovePocket)) return false;

    this.pushCooldown = CFG.pushCooldown;
    this.cutArmed = 0;
    this.debugPhase = 'contact';
    this.debugContactTimer = 0;

    // Push hard enough that, after the floor takes its cut, the ball
    // comes back up to hand height. Solving this from the ball's ACTUAL
    // current height every time is what makes the dribble self-
    // sustaining without needing the floor to be cheated: a ball that
    // came back low gets a harder push, one that came back high a
    // softer one.
    const handHeight = Math.max(0.2, this.handPos.y - floorY);
    const ballHeight = Math.max(0, ballPos.y - floorY);
    const e = CFG.floorRestitution;
    const pushSq = (2 * this.gravity * handHeight) / (e * e) - 2 * this.gravity * ballHeight;
    const push = THREE.MathUtils.clamp(Math.sqrt(Math.max(0, pushSq)), CFG.minPushSpeed, CFG.maxPushSpeed);
    this.debugPushSpeed = push;

    // How long this push takes to come back to the hand - the window the
    // recentering nudge has to work with.
    const arrival = Math.sqrt(push * push + 2 * this.gravity * ballHeight);
    const cycle = (arrival - push) / this.gravity + (e * arrival) / this.gravity;

    // Aim at where the hand will actually be one bounce from now, which
    // is the body's travel AND the swing the hand makes around it as the
    // player turns. Splitting the result into "the velocity the player
    // is carrying the ball at" and "the bit that closes the remaining
    // gap" is what lets the second half be capped hard: the ball is
    // moved by the player's own motion, never hauled along by a
    // correction term.
    this.player.getPredictedHandPosition(
      this.predictedHand,
      hand,
      height,
      playerVelocity ?? ZERO_VELOCITY,
      cycle,
    );
    const closeX = (this.predictedHand.x - ballPos.x) / cycle - travelVx;
    const closeZ = (this.predictedHand.z - ballPos.z) / cycle - travelVz;

    const vx = travelVx + THREE.MathUtils.clamp(closeX, -CFG.maxRecenter, CFG.maxRecenter);
    const vz = travelVz + THREE.MathUtils.clamp(closeZ, -CFG.maxRecenter, CFG.maxRecenter);
    this.ball.body.setLinvel({ x: vx, y: -push, z: vz }, true);

    // The hand comes over the top of the ball, so it always leaves the
    // hand turning - forward along the direction of travel, and about
    // the player's own facing when dribbling on the spot. Without this
    // a standing dribble measured 0.25 rad/s, i.e. a seamed ball that
    // never rotated at all, which is most of why it read as a prop
    // being carried rather than an object being handled.
    const speed = Math.hypot(vx, vz);
    let axisX: number;
    let axisZ: number;
    if (speed > 0.2) {
      axisX = -vz / speed;
      axisZ = vx / speed;
    } else {
      const facing = this.player.facingDirection; // topspin about the player's own right
      axisX = -facing.z;
      axisZ = facing.x;
    }
    const spin = Math.max(CFG.pushSpin, speed / CD.ball.radius);
    this.ball.body.setAngvel({ x: axisX * spin, y: 0, z: axisZ * spin }, true);
    return false;
  }

  /** Ball position the moment possession is lost/gained, useful for a clean handoff. */
  getHandAnchor(hand: 1 | -1, out: THREE.Vector3): THREE.Vector3 {
    return this.player.getHandPosition(out, hand, DRIBBLE_HEIGHT_NORMAL);
  }

  /** Debug panel fields - read-only, purely for the F8/F1 debug overlay. */
  get phase(): DribblePhase {
    return this.debugPhase;
  }

  /** Seconds since the last hand push. */
  get contactTimer(): number {
    return this.debugContactTimer;
  }

  /** Current horizontal distance between the ball and the dribbling hand. */
  get handDistance(): number {
    return this.debugHandDistance;
  }

  /** Downward speed of the last hand push, m/s. */
  get pushSpeed(): number {
    return this.debugPushSpeed;
  }
}
