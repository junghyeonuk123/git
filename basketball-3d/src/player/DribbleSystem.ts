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
  /**
   * Seconds the last complete bounce actually took, hand to hand.
   *
   * The push has to aim at where the pocket will be when the ball gets
   * back to it, which means knowing how long that will take. Deriving
   * that from CFG.floorRestitution is a guess, and the error does not
   * stay small: the ball simply arrives early or late, and at walking
   * pace a tenth of a second of error is a third of a metre of drift
   * per bounce, every bounce, always in the same direction. Measuring
   * the real round trip closes the loop - whatever Rapier's collision
   * actually does with the ball is what the next push is aimed with.
   */
  private measuredCycle = 0;
  /** Smoothed travel velocity, used only to orient and size the pocket's forward lead - see Player.getDribbleHandPosition. */
  private readonly leadVelocity = new THREE.Vector2(0, 0);
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

    const live = playerVelocity ?? ZERO_VELOCITY;
    const blend = 1 - Math.exp(-CFG.leadLambda * dt);
    this.leadVelocity.x += (live.x - this.leadVelocity.x) * blend;
    this.leadVelocity.y += (live.y - this.leadVelocity.y) * blend;
    this.player.getDribbleHandPosition(this.handPos, hand, height, live, this.leadVelocity, 0);

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
    // The hand being able to physically get to the ball is the one gate
    // nothing overrides.
    if (tooLow || outOfReach) return false;
    const recovering = gap > CFG.pocketGap;
    if (cutting) {
      // A cut puts a hand on the ball at the first chance it gets.
    } else if (recovering) {
      // Corralling a ball that got away: take it whenever it can be
      // touched, rather than waiting for the pocket's rhythm.
      if (this.pushCooldown > 0) return false;
    } else if (this.pushCooldown > 0 || stillRising || abovePocket) {
      return false;
    }

    // Time the bounce that just finished, before resetting the clock.
    // Only full rhythm-driven bounces count: a cut or a recovery push
    // deliberately interrupts the cycle, so timing one would teach the
    // predictor a round trip that never happened.
    if (!cutting && !recovering && this.debugContactTimer > 0.15 && this.debugContactTimer < 1.2) {
      this.measuredCycle =
        this.measuredCycle > 0
          ? THREE.MathUtils.lerp(this.measuredCycle, this.debugContactTimer, CFG.cycleLearnRate)
          : this.debugContactTimer;
    }

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

    // How long this push takes to come back to the hand. The analytic
    // value is only the opening guess, used until a real bounce has been
    // timed; after that the measured round trip wins.
    const arrival = Math.sqrt(push * push + 2 * this.gravity * ballHeight);
    const predicted = (arrival - push) / this.gravity + (e * arrival) / this.gravity;
    const cycle = this.measuredCycle > 0 ? this.measuredCycle : predicted;

    // Aim at where the hand will actually be one bounce from now, which
    // is the body's travel AND the swing the hand makes around it as the
    // player turns. Splitting the result into "the velocity the player
    // is carrying the ball at" and "the bit that closes the remaining
    // gap" is what lets the second half be capped hard: the ball is
    // moved by the player's own motion, never hauled along by a
    // correction term.
    this.player.getDribbleHandPosition(this.predictedHand, hand, height, live, this.leadVelocity, cycle);
    const closeX = (this.predictedHand.x - ballPos.x) / cycle - travelVx;
    const closeZ = (this.predictedHand.z - ballPos.z) / cycle - travelVz;

    const vx = travelVx + THREE.MathUtils.clamp(closeX, -CFG.maxRecenter, CFG.maxRecenter);
    const vz = travelVz + THREE.MathUtils.clamp(closeZ, -CFG.maxRecenter, CFG.maxRecenter);
    this.ball.body.setLinvel({ x: vx, y: -push, z: vz }, true);

    // The hand comes over the top of the ball, so it leaves the hand
    // rolling FORWARD. Two things ride on getting this sign right.
    //
    // Visually, a seamed ball that does not rotate reads as a prop being
    // carried rather than an object being handled - it measured 0.25
    // rad/s before any spin was set at all.
    //
    // Physically, it decides whether the bounce keeps the ball's speed
    // or eats it. Rolling spin puts the contact point at rest against
    // the floor, so there is almost no tangential impulse. The opposite
    // sign drags the contact point forward across the floor at speed and
    // friction answers with a big backward impulse: measured, a ball
    // pushed out at 5.5 m/s came off the floor at 0.9 m/s. That is the
    // ball being put down in front and then left behind by its own
    // bounce, which no amount of aiming the push further ahead can fix.
    //
    // Rolling in +X means spinning about -Z (the contact point travels
    // backward relative to the centre), so the axis is (v.z, 0, -v.x) -
    // the exact negation of the backspin axis a shot uses.
    const speed = Math.hypot(vx, vz);
    let axisX: number;
    let axisZ: number;
    if (speed > 0.2) {
      axisX = vz / speed;
      axisZ = -vx / speed;
    } else {
      const facing = this.player.facingDirection; // roll forward along the player's own facing
      axisX = facing.z;
      axisZ = -facing.x;
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
