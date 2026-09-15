import * as THREE from 'three';
import type { Player } from './Player';
import {
  SHOT_LEAPS,
  isFinish,
  shotApexSeconds,
  shotLift,
  type ShotLeap,
  type ShotStyle,
} from './ShotStyles';
import type { Ball } from '@/basketball/Ball';
import type { Hoop } from '@/basketball/Hoop';
import { solveLaunch, shotAngleForDistance } from '@/utils/Ballistics';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';

// Exported so ui/ShotMeter.ts draws the exact same zone boundaries the
// release logic below actually uses - one source of truth.
export const METER_CAP = 1.15;
/**
 * Also doubles as the swish window's lower bound. Widened from 0.62 when
 * FILL_RATE went to 1.7: the zones are meter units, so a faster fill
 * silently shrinks every window in real time, and the swish window would
 * have gone from 80ms to 47ms - the shot would have become much harder
 * purely as a side effect of fixing the animation. At 0.57 the window is
 * 79ms again, and it straddles the jump's apex (0.335-0.412s vs an apex
 * at 0.374s), so a well-timed release still leaves the hand at the top.
 */
export const ZONE_WEAK_MAX = 0.57;
export const ZONE_SWISH_MAX = 0.7;
export const ZONE_BANK_MAX = 0.8;

// A real jump shot's ball visibly rises from a low gather pocket up to a
// release point above the head as the shooter winds up - the ball was
// previously held at one fixed height (GATHER_HEIGHT=1.3) for the entire
// charge, which is a real chunk of why the shot read as having "no
// motion": the ball just sat still at chest height for over a second,
// then teleported into flight. pointArmAtBall already aims the whole arm
// at wherever the ball actually is every frame, so raising the ball's
// gather height over the charge gets a real winding-up arm motion for
// free, with no separate shooting-pose animation system needed.
const GATHER_HEIGHT_LOW = 1.0; // catch pocket, roughly hip/chest height
/**
 * Set point measured from the FLOOR; the jump adds its own lift on top.
 * A jumper releases around 1.75m. A finish carries the ball as high as
 * the arm goes, because the hand has to get it to a 3.05m rim: the dunk
 * value is this rig's full overhead reach, and the dunk's 1.22m leap on
 * top of it puts the ball at 3.27m, clear of the rim.
 */
const GATHER_HEIGHT_HIGH: Record<ShotStyle, number> = {
  jumper: 1.5,
  layup: 2.0,
  dunk: 2.05,
};

/** A finish is chosen by where the shooter is and how fast they are going at it, not by a button. */
const DUNK_RANGE = 2.4; // meters from the rim
/**
 * Closing speed a dunk needs, m/s. Sits between the walk (3.2) and the
 * sprint (6.2) on purpose, so the rule is one a player can actually
 * learn: sprint into the paint and you dunk it, drive at any less and
 * you lay it in. A lower threshold would make every drive a dunk and
 * layups would essentially never happen.
 */
const DUNK_APPROACH_SPEED = 4;
const LAYUP_RANGE = 4.2;

/**
 * Launch angle for a layup, degrees. Much steeper than the distance
 * heuristic a jump shot uses, which tops out at 50 and from a metre away
 * produces a flat line drive at the hoop: the ball arrives at the rim
 * moving nearly sideways, so the opening it has to fit through is at its
 * narrowest and it clangs. A layup is lofted precisely so it drops into
 * the cylinder rather than flying across it - that soft high touch is
 * the shot, not decoration.
 */
const LAYUP_ANGLE_DEG = 64;

/**
 * A layup lets go when the ball gets this close to the rim, rather than
 * at a fixed point in the jump - or at the apex, whichever comes first.
 *
 * Distance is what the shot actually needs, and timing only approximates
 * it. Released from under the basket the arc has to climb almost
 * vertically past the ring, which means it crosses the rim's plane on
 * the way UP right beside the iron and clips it from underneath. Letting
 * go a stride out puts that upward crossing well clear in front, so the
 * only time the ball is near the ring is on the way down, which is the
 * whole point of an arc.
 */
const LAYUP_RELEASE_DISTANCE = 1.9;
/**
 * ...but never before the ball has been carried up, however close the
 * drive started. This matters most for the case it looks least relevant
 * to: a player who presses from already under the basket has the
 * distance condition satisfied on the very first step, so a low value
 * here fires the shot at chest height from a metre out - the single
 * worst geometry available. Waiting until the ball is near full
 * extension is what gives that attempt a chance.
 */
const LAYUP_MIN_RELEASE_FRACTION = 0.8;

/**
 * Horizontal speed the ball is thrown at on a dunk, and the bounds on
 * how long that throw lasts. Capping the flight time both ways keeps the
 * ball arriving at the rim still moving downward: too fast and it skims
 * across the hoop into the far rim, too slow and it arcs and becomes a
 * floater rather than a stuff.
 */
const DUNK_THROW_SPEED = 3.2;
const DUNK_MIN_FLIGHT = 0.09;
const DUNK_MAX_FLIGHT = 0.3;

/** A dunk is barely alterable by a hand in your face; a layup very much is. */
const DUNK_CONTEST_SCALE = 0.4;

/** Clearance kept between the held ball and the face of the backboard - see clampClearOfBoard. */
const BOARD_CLEARANCE = 0.06;

/**
 * How far a dunker can stretch the ball toward the rim beyond where the
 * hand would otherwise be, in meters.
 *
 * A dunk is not thrown at the rim, it is reached over it, and that
 * distinction is not cosmetic. The hand anchor sits 0.44m out to the
 * side of the body, so aiming a dunk from there sent the ball ACROSS
 * the hoop at 3 m/s of lateral speed - it clipped the far rim and kicked
 * out nearly every time. Reaching first means the ball starts directly
 * above the hoop and simply drops through.
 *
 * It is a reach, not a magnet: it is capped, so a player who takes off
 * too early still has to throw the remaining distance, and that dunk
 * rattles exactly as it should.
 */
const DUNK_REACH = 0.55;

/** A dunk is put down, not shot - it gets a fraction of a jump shot's backspin. */
const DUNK_SPIN_SCALE = 0.25;
// Windup finishes right around the swish window's release timing, not at
// METER_CAP - holding past the sweet spot (bank/strong) keeps the ball
// at full extension rather than continuing to rise indefinitely.
const WINDUP_METER = ZONE_SWISH_MAX;

/**
 * Meter progress over which the ball is scooped up out of the dribble
 * into the shot pocket. Without this the ball TELEPORTED from wherever
 * the dribble had it (often down near the floor mid-bounce) straight up
 * to GATHER_HEIGHT_LOW on the frame the button went down, so pressing
 * shoot while dribbling had no gather at all - the ball simply appeared
 * at the chest. Short on purpose: a real gather is fast, it just isn't
 * instantaneous.
 */
const SCOOP_METER = 0.17; // ~0.10s at FILL_RATE

/**
 * How far the ball slides in from the dribbling hand toward the body's
 * centerline as the shot winds up. A jump shot is taken with two hands
 * on the ball, and Game.ts already points BOTH arms at it while
 * charging - but with the anchor left at the full dribbling-hand offset
 * the guide arm had to reach across the chest to get there, which read
 * as an awkward grab rather than a gather. 1 would be dead center; a
 * real set point stays slightly to the shooting side.
 */
const GATHER_CENTERING = 0.75;
/** How far a layup draws the ball in toward the centreline - less than a two-handed set, more than a dunk. */
const LAYUP_CENTERING = 0.55;
/**
 * Meter units per second. Raised from 1.0 so the swish window (meter
 * 0.62-0.70) is reached 0.36-0.41s after the button goes down, which is
 * exactly when a real jump lands its apex (Player.SHOT_TAKEOFF_SPEED
 * puts the peak at 0.374s). The old 1.0 needed 0.62-0.70s to get there,
 * and a jump cannot stay in the air that long without floating - the
 * meter's pace was quietly forcing the animation to be slower than
 * gravity. Timing the release well now means releasing at the top of a
 * real jump.
 */
const FILL_RATE = 1.7;
const BACKSPIN = 26; // rad/s, purely visual - see Ball seam rendering

export type ShotZone = 'weak' | 'swish' | 'bank' | 'strong';

export interface ShotResult {
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  zone: ShotZone;
  /** Which finish this was - a jump shot, a layup or a dunk. */
  style: ShotStyle;
  targetHoop: Hoop;
  points: 2 | 3;
  /** 0 = wide open, 1 = fully contested. Debug/UI only - see applyContest for how it actually perturbs the shot. */
  contestLevel: number;
  /** Raw defender distance at release, debug only. */
  contestDistance: number;
}

/** Beyond this defender distance, a shot is wide open. */
const CONTEST_OPEN_DISTANCE = 1.8;
/** At or inside this defender distance, contest is maxed out. */
const CONTEST_TIGHT_DISTANCE = 0.8;
/** Max left/right release deviation at full contest, radians. */
const CONTEST_MAX_ANGLE = 0.11;
/** Max over/under-power deviation at full contest, as a fraction of velocity magnitude. */
const CONTEST_MAX_POWER_PCT = 0.1;

function contestLevelFor(releasePos: THREE.Vector3, defenderPos: THREE.Vector3 | undefined): { level: number; distance: number } {
  if (!defenderPos) return { level: 0, distance: Infinity };
  const dist = releasePos.distanceTo(defenderPos);
  const level = THREE.MathUtils.clamp(
    1 - (dist - CONTEST_TIGHT_DISTANCE) / (CONTEST_OPEN_DISTANCE - CONTEST_TIGHT_DISTANCE),
    0,
    1,
  );
  return { level, distance: dist };
}

/**
 * A contested release is rushed/altered, not retargeted - this perturbs
 * the already-solved velocity (a real deviation the physics engine then
 * plays out for real, same as everything else about this shot) rather
 * than lowering some abstract "success chance". Section 31 of the
 * reference material is explicit that a contest must be locked in at
 * release and never retroactively touch the ball once it's in flight;
 * this is called once, synchronously, before ball.release() ever runs.
 */
function applyContest(velocity: THREE.Vector3, contestLevel: number): THREE.Vector3 {
  if (contestLevel <= 0) return velocity;
  const angle = (Math.random() * 2 - 1) * CONTEST_MAX_ANGLE * contestLevel;
  const power = 1 + (Math.random() * 2 - 1) * CONTEST_MAX_POWER_PCT * contestLevel;
  return velocity.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle).multiplyScalar(power);
}

/**
 * Point value is judged from the shooter's foot position at release
 * (spec section 8), not where the ball ends up. Rule 4-Section I's actual
 * three-point line is two pieces: a straight segment parallel to the
 * sideline near each corner (cornerDistance from the centerline, running
 * cornerLineLength in from the baseline - the same geometry Court.ts
 * already draws), and an arc everywhere else. A prior version of this
 * function used one uniform arc distance for the whole line, which made
 * the corner three require standing roughly 1.7ft farther out than the
 * real line does - a shooter behind the drawn corner line could still be
 * scored as a 2.
 */
function pointsForRelease(releasePos: THREE.Vector3, hoop: Hoop): 2 | 3 {
  const side: 1 | -1 = hoop.rimCenter.x >= 0 ? 1 : -1;
  const baselineX = side * (CD.length / 2);
  const distFromBaseline = side * (baselineX - releasePos.x);
  const lateralOffset = Math.abs(releasePos.z);

  if (distFromBaseline <= CD.threePoint.cornerLineLength && lateralOffset >= CD.threePoint.cornerDistance) {
    return 3;
  }

  const dist = Math.hypot(releasePos.x - hoop.rimCenter.x, releasePos.z - hoop.rimCenter.z);
  return dist >= CD.threePoint.arcDistance ? 3 : 2;
}

export function classifyMeter(meter: number): ShotZone {
  if (meter <= ZONE_WEAK_MAX) return 'weak';
  if (meter <= ZONE_SWISH_MAX) return 'swish';
  if (meter <= ZONE_BANK_MAX) return 'bank';
  return 'strong';
}

/**
 * Turns a hold-and-release meter into a real launch velocity via
 * projectile targeting (Ballistics.solveLaunch), then hands the ball
 * fully to physics - see spec section 12/45: the outcome is never
 * scripted, it's whatever the rim/backboard/net collisions actually do
 * with that velocity. The meter only decides which point the shot
 * *aims* at and how much power lands outside that: the swish window
 * targets the rim center, a slightly-too-strong release targets the
 * backboard (a bank shot), and everything else is a generic
 * over/under-powered attempt that may still rattle in or clank out.
 */
export class ShootingSystem {
  state: 'idle' | 'charging' = 'idle';
  meter = 0;
  /** Ball height above the court the frame the gather started, so the scoop begins from where the ball really was. */
  private gatherFromY = GATHER_HEIGHT_LOW;
  private currentStyle: ShotStyle = 'jumper';
  private releaseDue = false;

  /** Jump shot, layup or dunk - decided when the motion starts and fixed for its duration. */
  get style(): ShotStyle {
    return this.currentStyle;
  }

  get leap(): ShotLeap {
    return SHOT_LEAPS[this.currentStyle];
  }

  /**
   * True once a finish has reached the top of its jump.
   *
   * A layup and a dunk have no release timing to get right - the motion
   * is committed the moment it starts and plays out - so they let go at
   * the apex on their own rather than waiting for the button. Holding
   * the button through one would otherwise leave the player landing with
   * the ball still stuck above their head.
   */
  get autoReleaseDue(): boolean {
    return this.releaseDue;
  }

  /** Seconds the ball takes to reach full extension - a finish is fully extended by the earliest moment it could release. */
  private get windupSeconds(): number {
    if (!isFinish(this.currentStyle)) return WINDUP_METER / FILL_RATE;
    const apex = shotApexSeconds(this.leap);
    return this.currentStyle === 'layup' ? apex * LAYUP_MIN_RELEASE_FRACTION : apex;
  }

  /**
   * Real seconds since the shoot button went down. The meter fills at a
   * constant rate, so it doubles as the shot motion's clock - which is
   * what lets the body's jump run on gravity's timing (see
   * ShotStyles.shotLift) instead of on charge progress.
   */
  get chargeSeconds(): number {
    return this.meter / FILL_RATE;
  }

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly physicsGravity: number,
    private readonly physicsDt: number,
  ) {}

  /**
   * @param hoops so the finish can be chosen from how close the rim is
   * @param velocity the shooter's world-space X/Z travel, for the closing speed a dunk needs
   */
  startCharge(hoops: readonly Hoop[], velocity: THREE.Vector2): void {
    if (this.state !== 'idle') return;
    this.state = 'charging';
    this.meter = 0;
    this.releaseDue = false;
    this.currentStyle = chooseStyle(this.player.position, velocity, hoops);
    this.gatherFromY = THREE.MathUtils.clamp(
      this.ball.position.y - this.player.groundY,
      CD.ball.radius,
      GATHER_HEIGHT_LOW,
    );
  }

  /** Call once per fixed physics step while charging - holds the ball in a rising gather-to-release pose. */
  fixedUpdate(dt: number, hand: 1 | -1, hoops: readonly Hoop[]): void {
    if (this.state !== 'charging') return;
    this.meter = Math.min(METER_CAP, this.meter + FILL_RATE * dt);

    const windupT = Math.min(1, this.chargeSeconds / this.windupSeconds);
    const scoopT = Math.min(1, this.meter / SCOOP_METER);
    const setHeight = THREE.MathUtils.lerp(GATHER_HEIGHT_LOW, GATHER_HEIGHT_HIGH[this.currentStyle], windupT);
    // Scoop up out of the dribble first, then ride the windup.
    const pocketHeight = THREE.MathUtils.lerp(this.gatherFromY, setHeight, scoopT * scoopT * (3 - 2 * scoopT));

    // The ball rides the shooter's body up and back down with the jump
    // instead of being pinned to a height measured off the floor. That
    // pinning is what made a long hold look like levitation: past the
    // top of the windup the ball simply parked above the player's head
    // and hung there, motionless, while the body came back down out from
    // under it - so the shot appeared to be released from way up high by
    // someone floating. Adding the same lift the legs are producing
    // keeps ball and hands as one unit for the whole motion.
    const gatherHeight = pocketHeight + shotLift(this.chargeSeconds, this.leap);

    // A jump shot brings the ball in to the centreline for a two-handed
    // set. A dunk is the opposite and stays right out on the finishing
    // hand, because reachTowardRim then carries it over the hoop. A
    // layup sits between the two: the ball comes part way in as the arm
    // extends, which is both what the shot looks like and what stops the
    // release sitting 0.44m off to one side - from there every layup was
    // thrown across the rim rather than at it.
    const centering =
      this.currentStyle === 'dunk' ? 0 : this.currentStyle === 'layup' ? LAYUP_CENTERING : GATHER_CENTERING;
    const gatherPos = new THREE.Vector3();
    this.player.getHandPosition(gatherPos, hand * (1 - centering * windupT), gatherHeight);
    if (isFinish(this.currentStyle)) {
      const hoop = nearestHoop(hoops, gatherPos);
      if (this.currentStyle === 'dunk') reachTowardRim(gatherPos, hoop, windupT);
      clampClearOfBoard(gatherPos, hoop);
      this.releaseDue = this.finishReleaseDue(gatherPos, hoop);
    }
    this.ball.setKinematicHeld(gatherPos);
  }

  /**
   * Whether the finish has reached the moment it lets go: a dunk at the
   * top of the jump, a layup once it is close enough to the rim (see
   * LAYUP_RELEASE_DISTANCE) or at the apex, whichever comes first.
   */
  private finishReleaseDue(ballPos: THREE.Vector3, hoop: Hoop): boolean {
    const apex = shotApexSeconds(this.leap);
    if (this.chargeSeconds >= apex) return true;
    if (this.currentStyle !== 'layup') return false;
    if (this.chargeSeconds < apex * LAYUP_MIN_RELEASE_FRACTION) return false;
    return Math.hypot(hoop.rimCenter.x - ballPos.x, hoop.rimCenter.z - ballPos.z) <= LAYUP_RELEASE_DISTANCE;
  }

  /** Releases the shot at the nearest hoop. Returns null if not currently charging. */
  release(hoops: readonly Hoop[], defenderPosition?: THREE.Vector3): ShotResult | null {
    if (this.state !== 'charging') return null;
    this.state = 'idle';
    const meter = this.meter;

    const style = this.currentStyle;
    const releasePos = this.ball.position;
    const targetHoop = nearestHoop(hoops, releasePos);
    // A finish has no timing window to hit or miss, so it is never
    // graded against the meter - reporting one as "too strong" would be
    // scoring the player on an input they were never asked for.
    const zone = isFinish(style) ? 'swish' : classifyMeter(meter);

    const dxRim = Math.hypot(targetHoop.rimCenter.x - releasePos.x, targetHoop.rimCenter.z - releasePos.z);
    const rimAngle = shotAngleForDistance(dxRim);

    let velocity: THREE.Vector3;
    if (style === 'dunk') {
      velocity = this.solveDunk(releasePos, targetHoop);
    } else {
      const isLayup = style === 'layup';
      const target = isLayup ? targetHoop.rimCenter : zone === 'bank' ? targetHoop.bankSpot : targetHoop.rimCenter;
      const angle = isLayup ? THREE.MathUtils.degToRad(LAYUP_ANGLE_DEG) : rimAngle;
      const solution = solveLaunch(releasePos, target, angle, this.physicsGravity, this.physicsDt) ?? {
        velocity: new THREE.Vector3(0, 6, 0),
        speed: 6,
        angle,
      };
      velocity = solution.velocity;
      if (zone === 'weak' || zone === 'strong') {
        const factor =
          zone === 'weak'
            ? THREE.MathUtils.lerp(0.6, 0.9, meter / ZONE_WEAK_MAX)
            : THREE.MathUtils.lerp(1.08, 1.3, Math.min(1, (meter - ZONE_BANK_MAX) / (METER_CAP - ZONE_BANK_MAX)));
        velocity = velocity.clone().multiplyScalar(factor);
      }
    }

    const contest = contestLevelFor(releasePos, defenderPosition);
    velocity = applyContest(velocity, contest.level * (style === 'dunk' ? DUNK_CONTEST_SCALE : 1));

    const horizAxis = new THREE.Vector3(-velocity.z, 0, velocity.x).normalize();
    // A dunk barely spins: it is put down rather than shot, and a ball
    // carrying a jump shot's backspin has 3 m/s of surface speed, so any
    // graze of the rim throws it clean out of the cylinder.
    const angularVelocity = horizAxis.multiplyScalar(style === 'dunk' ? BACKSPIN * DUNK_SPIN_SCALE : BACKSPIN);

    this.ball.release(velocity, angularVelocity);
    const points = pointsForRelease(releasePos, targetHoop);
    return {
      velocity,
      angularVelocity,
      zone,
      style,
      targetHoop,
      points,
      contestLevel: contest.level,
      contestDistance: contest.distance,
    };
  }

  /**
   * A dunk is not a shot at the rim, it is the ball being carried above
   * the rim and put down through it, so it does not go through
   * solveLaunch at all - there is no arc to solve. The hand is already
   * higher than the target, which is exactly the case a launch-angle
   * solver cannot express.
   *
   * Instead the throw is aimed straight at the rim's centre over a short
   * flight, with the time picked so the ball is still travelling
   * downward when it gets there. It is then an ordinary dynamic body
   * again and the rim and net decide the rest, the same as every other
   * shot in the game - a dunk taken from a bad angle can and does rattle
   * out.
   */
  private solveDunk(releasePos: THREE.Vector3, hoop: Hoop): THREE.Vector3 {
    const dx = hoop.rimCenter.x - releasePos.x;
    const dz = hoop.rimCenter.z - releasePos.z;
    const flight = THREE.MathUtils.clamp(
      Math.hypot(dx, dz) / DUNK_THROW_SPEED,
      DUNK_MIN_FLIGHT,
      DUNK_MAX_FLIGHT,
    );
    const dy = hoop.rimCenter.y - releasePos.y;
    return new THREE.Vector3(
      dx / flight,
      (dy + 0.5 * this.physicsGravity * flight * flight) / flight,
      dz / flight,
    );
  }
}

/**
 * Picks the finish from the situation rather than from a separate
 * button: close and moving hard at the rim is a dunk, close at any speed
 * is a layup, anything else is a jump shot. That is how it reads to a
 * player - you drive and it happens - and it means the shoot button
 * keeps doing one thing.
 */
/**
 * Keeps the held ball on the court side of the backboard.
 *
 * A finish carries the ball to rim height at exactly the spot the board
 * occupies, and a driver whose momentum takes them under the basket
 * would otherwise have it held - and then released - INSIDE a solid
 * collider. Rapier resolves that the only way it can, by ejecting the
 * ball, so the dunk ended with it dropping straight to the floor off the
 * back of the board. Clamping is the fix because the ball is kinematic
 * here: while the hand owns it, the hand does not get to put it inside
 * things.
 */
/**
 * Stretches the held ball toward the point directly above the rim as the
 * dunk winds up, by at most DUNK_REACH - see that constant for why this
 * exists at all.
 */
function reachTowardRim(pos: THREE.Vector3, hoop: Hoop, windupT: number): void {
  const dx = hoop.rimCenter.x - pos.x;
  const dz = hoop.rimCenter.z - pos.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-4) return;
  const reach = Math.min(distance, DUNK_REACH * windupT);
  pos.x += (dx / distance) * reach;
  pos.z += (dz / distance) * reach;
}

function clampClearOfBoard(pos: THREE.Vector3, hoop: Hoop): void {
  const side = Math.sign(hoop.rimCenter.x) || 1;
  const faceX = hoop.rimCenter.x + side * CD.hoop.rimDistanceFromBackboard;
  const limit = faceX - side * (CD.ball.radius + BOARD_CLEARANCE);
  pos.x = side > 0 ? Math.min(pos.x, limit) : Math.max(pos.x, limit);
}

function chooseStyle(from: THREE.Vector3, velocity: THREE.Vector2, hoops: readonly Hoop[]): ShotStyle {
  const rim = nearestHoop(hoops, from).rimCenter;
  const dx = rim.x - from.x;
  const dz = rim.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > LAYUP_RANGE) return 'jumper';
  if (distance < 1e-3) return 'layup';
  // How fast the shooter is actually closing on the rim, not how fast
  // they happen to be moving - running past the basket is not a dunk.
  const closingSpeed = (velocity.x * dx + velocity.y * dz) / distance; // .y stores world Z
  return distance <= DUNK_RANGE && closingSpeed >= DUNK_APPROACH_SPEED ? 'dunk' : 'layup';
}

export function nearestHoop(hoops: readonly Hoop[], from: THREE.Vector3): Hoop {
  let best = hoops[0]!;
  let bestDist = Infinity;
  for (const hoop of hoops) {
    const d = from.distanceToSquared(hoop.rimCenter);
    if (d < bestDist) {
      bestDist = d;
      best = hoop;
    }
  }
  return best;
}
