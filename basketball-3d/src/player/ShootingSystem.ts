import * as THREE from 'three';
import { shotChargeLift, type Player } from './Player';
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
const GATHER_HEIGHT_HIGH = 1.50; // set point measured from the FLOOR; the jump adds its own 0.25 on top, so the ball actually leaves the hand around 1.75
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

  /**
   * Real seconds since the shoot button went down. The meter fills at a
   * constant rate, so it doubles as the shot motion's clock - which is
   * what lets the body's jump run on gravity's timing (see
   * Player.shotChargeLift) instead of on charge progress.
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

  startCharge(): void {
    if (this.state !== 'idle') return;
    this.state = 'charging';
    this.meter = 0;
    this.gatherFromY = THREE.MathUtils.clamp(
      this.ball.position.y - this.player.groundY,
      CD.ball.radius,
      GATHER_HEIGHT_LOW,
    );
  }

  /** Call once per fixed physics step while charging - holds the ball in a rising gather-to-release pose. */
  fixedUpdate(dt: number, hand: 1 | -1): void {
    if (this.state !== 'charging') return;
    this.meter = Math.min(METER_CAP, this.meter + FILL_RATE * dt);

    const windupT = Math.min(1, this.meter / WINDUP_METER);
    const scoopT = Math.min(1, this.meter / SCOOP_METER);
    const setHeight = THREE.MathUtils.lerp(GATHER_HEIGHT_LOW, GATHER_HEIGHT_HIGH, windupT);
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
    const gatherHeight = pocketHeight + shotChargeLift(this.chargeSeconds);

    const gatherPos = new THREE.Vector3();
    this.player.getHandPosition(gatherPos, hand * (1 - GATHER_CENTERING * windupT), gatherHeight);
    this.ball.setKinematicHeld(gatherPos);
  }

  /** Releases the shot at the nearest hoop. Returns null if not currently charging. */
  release(hoops: readonly Hoop[], defenderPosition?: THREE.Vector3): ShotResult | null {
    if (this.state !== 'charging') return null;
    this.state = 'idle';
    const meter = this.meter;

    const releasePos = this.ball.position;
    const targetHoop = nearestHoop(hoops, releasePos);
    const zone = classifyMeter(meter);

    const dxRim = Math.hypot(targetHoop.rimCenter.x - releasePos.x, targetHoop.rimCenter.z - releasePos.z);
    const rimAngle = shotAngleForDistance(dxRim);

    let solution =
      zone === 'bank'
        ? solveLaunch(releasePos, targetHoop.bankSpot, shotAngleForDistance(dxRim), this.physicsGravity, this.physicsDt)
        : solveLaunch(releasePos, targetHoop.rimCenter, rimAngle, this.physicsGravity, this.physicsDt);

    if (!solution) {
      solution = { velocity: new THREE.Vector3(0, 6, 0), speed: 6, angle: rimAngle };
    }

    let velocity = solution.velocity;
    if (zone === 'weak' || zone === 'strong') {
      const factor =
        zone === 'weak'
          ? THREE.MathUtils.lerp(0.6, 0.9, meter / ZONE_WEAK_MAX)
          : THREE.MathUtils.lerp(1.08, 1.3, Math.min(1, (meter - ZONE_BANK_MAX) / (METER_CAP - ZONE_BANK_MAX)));
      velocity = velocity.clone().multiplyScalar(factor);
    }

    const contest = contestLevelFor(releasePos, defenderPosition);
    velocity = applyContest(velocity, contest.level);

    const horizAxis = new THREE.Vector3(-velocity.z, 0, velocity.x).normalize();
    const angularVelocity = horizAxis.multiplyScalar(BACKSPIN);

    this.ball.release(velocity, angularVelocity);
    const points = pointsForRelease(releasePos, targetHoop);
    return { velocity, angularVelocity, zone, targetHoop, points, contestLevel: contest.level, contestDistance: contest.distance };
  }
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
