import * as THREE from 'three';
import type { Player } from './Player';
import {
  SHOT_STYLE_SPECS,
  isDropFinish,
  isFinish,
  shotApexSeconds,
  shotLift,
  type ShotLeap,
  type ShotStyle,
  type ShotStyleSpec,
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
// The set point each style winds up to lives in SHOT_STYLE_SPECS, next
// to the leap that has to agree with it - see ShotStyles.ts.

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
 * THE FIVE FINISHES, AND WHAT PICKS EACH ONE
 *
 * Every one of these is a real shot with a real reason for existing, and
 * the reason is always the same shape: from where you are, with the
 * speed you have and the defender you have, it is the finish that gets
 * the ball to the rim. So none of them has its own button - the
 * situation picks, exactly the way it does on a court, and the player
 * learns them by learning the situations (see chooseStyle).
 *
 *   reverse     you have gone under the basket, or you are crossing it
 *               on the baseline: the rim is now between you and a normal
 *               layup, so you carry the ball through and lay it in on
 *               the FAR side, with the rim and your own body shielding
 *               it from behind.
 *   fingerRoll  you are underneath, with no runway to arc anything: you
 *               reach up and roll it off the fingertips, over the front
 *               of the ring and down, no glass.
 *   power       you are close but you are not going anywhere - gathered
 *               up, stopped, both feet down. You go straight up square
 *               to the board and bank it in hard.
 *   floater     you are in the in-between zone, too far to lay it in and
 *               with a defender in the way. You go up off one foot early
 *               and drop it over them before they can climb.
 *   layup       the ordinary two-stride drive finish, laid up on the way
 *               past the rim.
 */

/** Past the rim toward the baseline, or crossing it sideways - either way it is a reverse. */
const REVERSE_RANGE = 1.8;
/** Lateral (across-the-rim) speed that reads as a baseline drive rather than an attack at the front of the rim, m/s. */
const REVERSE_LATERAL_SPEED = 1.6;
/**
 * How far past the rim's centre a reverse carries the ball before
 * laying it back in, in meters. This IS the shot: the ball finishes on
 * the opposite side from where the drive came, which is what puts the
 * ring between it and everyone trailing the play.
 */
const REVERSE_CARRY = 0.28;
const REVERSE_DROP_SPEED = 2.0;

/** Reaching up from directly underneath - inside this there is no arc to be had at all. */
const FINGER_ROLL_RANGE = 1.3;
/** Softer than a laid-over layup and much softer than a dunk: the ball is rolled off the fingers, not thrown. */
const FINGER_ROLL_SPEED = 1.7;

/** A jump stop happens close in, and by definition it happens slowly. */
const POWER_RANGE = 2.4;
const POWER_CLOSING_SPEED = 1.3; // m/s - above this you are still driving, and a drive is a layup
/** Flatter than a layup, because a power finish is driven into the glass rather than lofted over the ring. */
const POWER_ANGLE_DEG = 58;
/**
 * How far above the rim a power finish hits the board, in meters -
 * roughly the top of the painted square, which is what a player banking
 * one in from underneath is actually aiming at.
 *
 * Higher than the jump shot's bank spot (rim + 0.18) on purpose. The
 * ball has to come off the glass and still have room to fall the 0.38m
 * back out to the ring; from rim + 0.18 the rebound was measured
 * returning only about 0.05m horizontally before it was already level
 * with the rim, so it dropped straight down the face of the board.
 *
 * Simulated against the real board restitution across the whole range
 * this shot is taken from and every release height it is taken at, 0.35
 * at 58 degrees puts the ball back through the ring every time, with
 * the worst case still 0.03m inside the cylinder. Raising it further
 * starts missing long from close in, and flattening the angle misses
 * long everywhere.
 */
const POWER_BANK_RISE = 0.35;

/** The in-between zone: too far to lay in, close enough that a jump shot is the wrong answer. */
const FLOATER_MIN_RANGE = 2.4;
/** A floater exists because someone is in the way - with nobody there, drive it. */
const FLOATER_CONTEST_DISTANCE = 2.4;
/** Far steeper than a jump shot, so it comes down almost vertically into the cylinder. */
const FLOATER_ANGLE_DEG = 72;
/**
 * A floater is let go on the way UP, well before the top of the jump -
 * that early release is the entire shot. Held to the apex it stops
 * being a floater and becomes a short jumper the defender has had time
 * to get a hand to.
 */
const FLOATER_RELEASE_FRACTION = 0.55;

/**
 * Launch angle for a layup, degrees, and it goes off the GLASS - at
 * hoop.bankSpot, the same point on the square a jump shot banks off.
 *
 * That is what a layup is. Lofting one at the rim's centre instead,
 * which is what this did at 64 degrees, is not a layup at all: it
 * produces a high looping ball over the front of the ring, which is a
 * floater, and it made the two shots indistinguishable. A layup is
 * scooped UP into the square from close in and drops off the glass, and
 * the angle is flat enough to read as a scoop rather than a loop.
 *
 * Simulated against the real board restitution from 0.9m to 2.3m out
 * and across every release height the shot is taken at, 46 degrees into
 * the existing bank spot goes in from all of them, with the worst case
 * still 0.02m inside the cylinder, and clears the near edge of the ring
 * on the way to the board by 0.04m at worst. Flatter than this and the
 * ball rebounds off the glass too horizontally to fall back into the
 * ring; steeper starts looking like the loop this replaced.
 */
const LAYUP_ANGLE_DEG = 46;

/**
 * A layup lets go when the ball gets this close to the rim, rather than
 * at a fixed point in the jump - or at the apex, whichever comes first.
 *
 * Distance is what the shot actually needs, and timing only approximates
 * it. Released from under the basket there is no angle into the glass at
 * all, because the board is overhead rather than in front - so the shot
 * has to let go while it still has some floor ahead of it. Close to the
 * basket, which is where a layup is taken from, but not underneath it.
 */
const LAYUP_RELEASE_DISTANCE = 1.5;
/**
 * Inside this, a layup stops being an arc at all and is laid over the
 * rim instead - it goes all the way to the top of the jump and drops the
 * ball in, the same shape as a dunk but soft.
 *
 * From under the basket the backboard is overhead rather than in front,
 * so there is no angle into it and nothing to bank off - and the only
 * arc that reaches the ring from below has to climb past the iron and
 * fouls it on the way up, 0.127m between centres against 0.141m of
 * combined radius. Laying the ball over the rim from above is the shot
 * a player actually takes from there, and it is the only one the
 * geometry allows.
 */
const LAYUP_DROP_DISTANCE = 0.9;
/** Horizontal speed a laid-over layup is dropped with - gentler than a dunk's stuff. */
const LAYUP_DROP_SPEED = 2.2;
/**
 * ...but never before the ball has been carried up, however close the
 * drive started. This matters most for the case it looks least relevant
 * to: a player who presses from already under the basket has the
 * distance condition satisfied on the very first step, so a low value
 * here fires the shot at chest height from a metre out - the single
 * worst geometry available.
 *
 * Well short of the top of the jump, though. A layup is scooped up and
 * released ON THE RISE; holding it to the apex both looks wrong and
 * carries the ball above the square it is meant to be laying it into.
 */
const LAYUP_MIN_RELEASE_FRACTION = 0.6;

/**
 * Horizontal speed the ball is thrown at on a dunk, and the bounds on
 * how long that throw lasts. Capping the flight time both ways keeps the
 * ball arriving at the rim still moving downward: too fast and it skims
 * across the hoop into the far rim, too slow and it arcs and becomes a
 * floater rather than a stuff.
 */
const DUNK_THROW_SPEED = 3.2;
const DROP_MIN_FLIGHT = 0.09;
const DROP_MAX_FLIGHT = 0.3;
/**
 * Everything laid in softly gets a longer flight than a dunk, and it is
 * what makes those shots work rather than a matter of taste. All of
 * them finish from off to the side of the ring, so the ball has to pass
 * OVER the iron on its way in - and a longer flight is a higher, more
 * arced one. Capped at a dunk's 0.3, the finger roll was measured
 * crossing the near edge of the ring 0.04m too low and clipping it.
 */
const SOFT_DROP_MAX_FLIGHT = 0.5;

/**
 * How much a hand in the face gets to alter each finish. A dunk is
 * barely alterable; a power finish is meant to be taken through
 * contact; a floater's whole purpose is to be released where the
 * contest cannot reach it. An ordinary layup is very much alterable.
 */
const CONTEST_SCALE: Partial<Record<ShotStyle, number>> = {
  dunk: 0.4,
  power: 0.5,
  floater: 0.6,
};

/**
 * Backspin, as a fraction of a jump shot's. Anything put down from
 * above the rim gets very little: a ball carrying a jump shot's
 * backspin has about 3 m/s of surface speed, so any graze of the ring
 * throws it clean out of the cylinder. A finger roll keeps a touch more
 * than a dunk because that soft roll off the fingertips is the shot,
 * and a power finish keeps all of it - backspin is what makes a hard
 * bank stick to the glass instead of skidding off it.
 */
const SPIN_SCALE: Partial<Record<ShotStyle, number>> = {
  dunk: 0.25,
  fingerRoll: 0.35,
  reverse: 0.5,
};

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
/**
 * How far each finish draws the ball in toward the centreline, where 0
 * leaves it right out on the finishing hand and 1 is dead centre. A
 * dunk and the two reaches stay out on the hand, because the hand is
 * what carries the ball over the ring. A power finish is gathered in
 * with two hands like a jump shot. A layup sits between the two.
 */
const CENTERING: Partial<Record<ShotStyle, number>> = {
  dunk: 0,
  fingerRoll: 0,
  reverse: 0,
  layup: 0.55,
  floater: 0.5,
};
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
  /**
   * Which way across the rim a reverse carries the ball, as the sign of
   * world Z. Fixed when the motion starts, because it has to be: the
   * player's lateral velocity is what chooses it, and that velocity is
   * gone by the time the ball is being laid in on the far side.
   */
  private reverseSign: 1 | -1 = 1;

  /** Which of the seven this is - decided when the motion starts and fixed for its duration. */
  get style(): ShotStyle {
    return this.currentStyle;
  }

  get spec(): ShotStyleSpec {
    return SHOT_STYLE_SPECS[this.currentStyle];
  }

  get leap(): ShotLeap {
    return this.spec.leap;
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
    // Two of them let go before the top of the jump, so they have to be
    // fully extended earlier than the rest or the ball leaves the hand
    // while the arm is still on its way up.
    if (this.currentStyle === 'layup') return apex * LAYUP_MIN_RELEASE_FRACTION;
    if (this.currentStyle === 'floater') return apex * FLOATER_RELEASE_FRACTION;
    return apex;
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
   * @param defenderPosition so a floater can be chosen when there is actually somebody to shoot over
   */
  startCharge(hoops: readonly Hoop[], velocity: THREE.Vector2, defenderPosition?: THREE.Vector3): void {
    if (this.state !== 'idle') return;
    this.state = 'charging';
    this.meter = 0;
    this.releaseDue = false;
    const from = this.player.position;
    this.currentStyle = chooseStyle(from, velocity, hoops, defenderPosition);
    this.reverseSign = reverseCarrySign(from, velocity, nearestHoop(hoops, from));
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
    const setHeight = THREE.MathUtils.lerp(GATHER_HEIGHT_LOW, this.spec.setHeight, windupT);
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
    const centering = CENTERING[this.currentStyle] ?? GATHER_CENTERING;
    const gatherPos = new THREE.Vector3();
    this.player.getHandPosition(gatherPos, hand * (1 - centering * windupT), gatherHeight);
    if (isFinish(this.currentStyle)) {
      const hoop = nearestHoop(hoops, gatherPos);
      // Anything put down from above the ring is reached there first
      // rather than thrown at it - the hand anchor sits 0.44m out to the
      // side of the body, and aiming from there sends the ball ACROSS
      // the hoop instead of into it. A layup is reached the same way,
      // but only once it is close enough to be laying the ball over
      // rather than arcing it in: reaching on an arc layup would eat the
      // horizontal distance that shot is deliberately keeping.
      const laying = this.currentStyle === 'layup' && rimDistance(gatherPos, hoop) <= LAYUP_DROP_DISTANCE;
      if (this.currentStyle === 'reverse') {
        // A reverse reaches PAST the rim, not to it: the ball finishes
        // on the far side and is laid back in from there.
        reachTowardPoint(gatherPos, reverseAnchor(hoop, this.reverseSign), windupT);
      } else if (isDropFinish(this.currentStyle) || laying) {
        reachTowardPoint(gatherPos, hoop.rimCenter, windupT);
      }
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
    // The one that deliberately goes early - see FLOATER_RELEASE_FRACTION.
    if (this.currentStyle === 'floater') return this.chargeSeconds >= apex * FLOATER_RELEASE_FRACTION;
    if (this.chargeSeconds >= apex) return true;
    if (this.currentStyle !== 'layup') return false;
    // Close in, the shot is a lay-over rather than an arc, and it needs
    // every centimetre of the jump to clear the rim - so it waits for
    // the top even though the distance condition is long since met.
    if (rimDistance(ballPos, hoop) <= LAYUP_DROP_DISTANCE) return false;
    if (this.chargeSeconds < apex * LAYUP_MIN_RELEASE_FRACTION) return false;
    return rimDistance(ballPos, hoop) <= LAYUP_RELEASE_DISTANCE;
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
    if (isDropFinish(style) || (style === 'layup' && rimDistance(releasePos, targetHoop) <= LAYUP_DROP_DISTANCE)) {
      // No arc to solve: the hand is already above the ring, so the ball
      // is put down through it rather than shot at it. How hard it is
      // put down is the whole difference between these - a dunk is
      // stuffed, a reverse is flipped back across, a finger roll is
      // barely thrown at all.
      const throwSpeed =
        style === 'dunk'
          ? DUNK_THROW_SPEED
          : style === 'fingerRoll'
            ? FINGER_ROLL_SPEED
            : style === 'reverse'
              ? REVERSE_DROP_SPEED
              : LAYUP_DROP_SPEED;
      const maxFlight = style === 'dunk' ? DROP_MAX_FLIGHT : SOFT_DROP_MAX_FLIGHT;
      velocity = this.solveDrop(releasePos, targetHoop, throwSpeed, maxFlight);
    } else {
      // A power finish is the only finish aimed at the glass rather than
      // at the ring: squared up underneath, there is no room to loft
      // anything over the front of the rim, so it goes off the square.
      // A layup and a power finish are the two shots taken close enough
      // to the basket to use the glass, and using it is what makes each
      // look like itself. A power finish is squared up underneath and
      // needs a higher point on the square than a layup scooping in off
      // the drive.
      const target =
        style === 'power'
          ? powerBankSpot(targetHoop)
          : style === 'layup' || (style === 'jumper' && zone === 'bank')
            ? targetHoop.bankSpot
            : targetHoop.rimCenter;
      const angle =
        style === 'layup'
          ? THREE.MathUtils.degToRad(LAYUP_ANGLE_DEG)
          : style === 'floater'
            ? THREE.MathUtils.degToRad(FLOATER_ANGLE_DEG)
            : style === 'power'
              ? THREE.MathUtils.degToRad(POWER_ANGLE_DEG)
              : rimAngle;
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
    velocity = applyContest(velocity, contest.level * (CONTEST_SCALE[style] ?? 1));

    const horizAxis = new THREE.Vector3(-velocity.z, 0, velocity.x).normalize();
    const angularVelocity = horizAxis.multiplyScalar(BACKSPIN * (SPIN_SCALE[style] ?? 1));

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
   * Putting the ball down from above the rim rather than shooting at it -
   * a dunk, or a layup laid over the rim from underneath. Neither goes
   * through solveLaunch, because there is no arc to solve. The hand is already
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
  private solveDrop(
    releasePos: THREE.Vector3,
    hoop: Hoop,
    throwSpeed: number,
    maxFlight: number = DROP_MAX_FLIGHT,
  ): THREE.Vector3 {
    const dx = hoop.rimCenter.x - releasePos.x;
    const dz = hoop.rimCenter.z - releasePos.z;
    const flight = THREE.MathUtils.clamp(
      Math.hypot(dx, dz) / throwSpeed,
      DROP_MIN_FLIGHT,
      maxFlight,
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
 * Stretches the held ball horizontally toward `target` as the finish
 * winds up, by at most DUNK_REACH - see that constant for why this
 * exists at all.
 */
function reachTowardPoint(pos: THREE.Vector3, target: THREE.Vector3, windupT: number): void {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
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

function rimDistance(pos: THREE.Vector3, hoop: Hoop): number {
  return Math.hypot(hoop.rimCenter.x - pos.x, hoop.rimCenter.z - pos.z);
}

/** The point on the far side of the ring a reverse carries the ball out to before laying it back in. */
function reverseAnchor(hoop: Hoop, sign: 1 | -1): THREE.Vector3 {
  return new THREE.Vector3(hoop.rimCenter.x, hoop.rimCenter.y, hoop.rimCenter.z + sign * REVERSE_CARRY);
}

/** Roughly the top of the painted square - what a power finish banks off. */
function powerBankSpot(hoop: Hoop): THREE.Vector3 {
  return new THREE.Vector3(hoop.bankSpot.x, hoop.rimCenter.y + POWER_BANK_RISE, hoop.bankSpot.z);
}

/**
 * Which way across the rim a reverse finishes. Moving, it continues the
 * way the drive was already going, which is what carries the ball
 * through and out the other side. Standing under the basket there is no
 * drive to continue, so it goes across to the side the player is not
 * already on - either way the ring ends up between the ball and where
 * the player came from, which is the point of the shot.
 */
function reverseCarrySign(from: THREE.Vector3, velocity: THREE.Vector2, hoop: Hoop): 1 | -1 {
  if (Math.abs(velocity.y) > 0.8) return velocity.y >= 0 ? 1 : -1; // .y stores world Z
  return from.z - hoop.rimCenter.z >= 0 ? -1 : 1;
}

/** True once the shooter is behind the ring, between it and the baseline - there is no shot from there but a reverse. */
function isBehindRim(from: THREE.Vector3, rim: THREE.Vector3): boolean {
  const side = Math.sign(rim.x) || 1;
  return side * (from.x - rim.x) > 0;
}

/**
 * Picks the finish from the situation rather than from a separate
 * button. Order matters here and it is the order of how forced each
 * choice is: behind the rim there is literally nothing else available,
 * underneath it there is no runway to arc anything, and only once none
 * of those apply does it come down to speed and to whether somebody is
 * in the way.
 */
function chooseStyle(
  from: THREE.Vector3,
  velocity: THREE.Vector2,
  hoops: readonly Hoop[],
  defenderPosition?: THREE.Vector3,
): ShotStyle {
  const rim = nearestHoop(hoops, from).rimCenter;
  const dx = rim.x - from.x;
  const dz = rim.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance > LAYUP_RANGE) return 'jumper';
  if (distance < 1e-3) return 'fingerRoll';

  // How fast the shooter is actually closing on the rim, not how fast
  // they happen to be moving - running past the basket is not a dunk.
  const closingSpeed = (velocity.x * dx + velocity.y * dz) / distance; // .y stores world Z
  // ...and the part of that travel going ACROSS the rim rather than at
  // it, which is what a baseline drive looks like from here.
  const lateralSpeed = Math.abs((velocity.x * dz - velocity.y * dx) / distance);

  if (distance <= DUNK_RANGE && closingSpeed >= DUNK_APPROACH_SPEED) return 'dunk';
  if (distance <= REVERSE_RANGE && (isBehindRim(from, rim) || lateralSpeed >= REVERSE_LATERAL_SPEED)) {
    return 'reverse';
  }
  if (distance <= FINGER_ROLL_RANGE) return 'fingerRoll';
  if (distance <= POWER_RANGE && closingSpeed < POWER_CLOSING_SPEED) return 'power';
  if (
    distance >= FLOATER_MIN_RANGE &&
    defenderPosition !== undefined &&
    from.distanceTo(defenderPosition) <= FLOATER_CONTEST_DISTANCE
  ) {
    return 'floater';
  }
  return 'layup';
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
