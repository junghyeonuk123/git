/**
 * What kind of shot is being taken, and everything about it that both
 * the body and the ball need to agree on.
 *
 * This lives in its own module because both halves of a shot read it and
 * neither should own it: Player.ts drives the pose from the leap,
 * ShootingSystem.ts drives the ball's height from the same leap, and
 * they have to agree exactly or the ball and the hands come apart in
 * mid-air.
 *
 * THE FINISHES
 *
 * The five ways of finishing at the rim are the real ones, taken from
 * how each is actually taught, and each is picked from the situation
 * rather than from its own button (see ShootingSystem.chooseStyle):
 *
 *   layup       the two-stride drive finish, laid up on the way past
 *   fingerRoll  reached up from underneath and rolled off the fingers,
 *               over the front of the rim, no glass
 *   reverse     carried under the basket and finished on the FAR side,
 *               using the rim and your own body to shield it
 *   floater     the high one-foot runner from the in-between zone,
 *               released early and over a taller defender
 *   power       a two-foot jump stop, shoulders squared to the board,
 *               banked in hard
 *   dunk        put down through the rim from above it
 */

export type ShotStyle = 'jumper' | 'floater' | 'layup' | 'fingerRoll' | 'reverse' | 'power' | 'dunk';

export interface ShotLeap {
  /**
   * Seconds spent taking the gather strides before the plant, while the
   * ball is already in two hands and the player is still driving.
   *
   * This is the two-step every layup is built on: you pick the ball up
   * out of the dribble, take two strides with it, and go up off the
   * inside foot. Zero for everything taken from a standstill or from
   * under the basket, where there is no runway to step into.
   */
  strideSeconds: number;
  /** Seconds spent sinking into the plant, after the strides, before the legs fire. */
  dipSeconds: number;
  /**
   * Takeoff speed, m/s. Everything else about the jump - apex height,
   * time to the apex, hang time - follows from this and gravity rather
   * than being authored separately, which is what keeps the motion at
   * gravity's pace instead of an animator's.
   */
  takeoffSpeed: number;
}

export interface ShotStyleSpec {
  leap: ShotLeap;
  /** Ball height above the floor at full extension, before the jump adds its lift. */
  setHeight: number;
  /**
   * True for a jump stop off both feet. A one-foot drive finish splits
   * the legs - the knee on the finishing side drives up and the other
   * trails - where a two-foot gather goes up square and symmetrical,
   * which is the whole look of a power finish.
   */
  twoFooted: boolean;
  /** Shown on the shot meter in place of a timing zone. */
  label: string;
}

const SHOT_JUMP_GRAVITY = 9.81;

/**
 * Seconds per gather stride. The stride window is always a whole number
 * of these, because a stride is a discrete thing: half of one leaves a
 * leg swung out in front with nothing to plant it on, and the body then
 * snaps back into the dip. See Player.poseGatherStrides.
 */
export const SHOT_STEP_SECONDS = 0.25;

/** How many gather strides a leap's stride window holds. */
export function shotStrideSteps(leap: ShotLeap): number {
  return Math.round(leap.strideSeconds / SHOT_STEP_SECONDS);
}

/**
 * Apex heights fall out as v^2/2g, so these are jump heights, not
 * curves: jumper 0.25m, floater 0.46m, power 0.78m, and 1.22m for the
 * four that finish at the ring itself.
 *
 * That 1.22m is high for a vertical leap and is set by the rig rather
 * than by taste: this character's shoulder is at 1.55m with a 0.50m
 * arm, so its overhead reach is only about 2.05m where a real player of
 * the same height reaches nearer 2.6m. The legs have to make up what the
 * arms do not - and what they have to make up is not rim height but
 * RING clearance. Getting the ball to 3.08m only puts its centre level
 * with the rim; a ball laid in from the side has to pass over the iron
 * itself, which needs its centre at 3.19m (rim + tube + ball radius).
 * Measured at 1.03m of lift, the finger roll, the reverse and a layup
 * taken from under the basket all clipped the near edge of the ring on
 * the way in - the last of those being exactly the shot that kept
 * rattling out from a metre away. At 1.22m all three clear it from
 * every distance they are taken from.
 */
export const SHOT_STYLE_SPECS: Record<ShotStyle, ShotStyleSpec> = {
  jumper: {
    leap: { strideSeconds: 0, dipSeconds: 0.15, takeoffSpeed: 2.2 },
    setHeight: 1.5,
    twoFooted: false,
    label: '',
  },
  floater: {
    // Quick off one foot and released on the rise - the shot's whole
    // point is getting it away before the defender can climb.
    leap: { strideSeconds: 0, dipSeconds: 0.12, takeoffSpeed: 3.0 },
    setHeight: 1.85,
    twoFooted: false,
    label: 'FLOATER',
  },
  layup: {
    // A layup that starts far enough out arcs the ball in, but one that
    // gets all the way under the basket lays it over the ring instead,
    // and that is the case this leap is set by - see the note above.
    // The only finish with a gather stride phase, because it is the only
    // one taken on the move with room to step into: two strides with the
    // ball in both hands, then up off the inside foot.
    leap: { strideSeconds: 0.5, dipSeconds: 0.1, takeoffSpeed: 4.9 },
    setHeight: 2.05,
    twoFooted: false,
    label: 'LAYUP',
  },
  fingerRoll: {
    // Same leap as a dunk, and for the same reason: both finish from
    // directly underneath, where the ball has to clear the ring itself
    // rather than just reach rim height. See the note above.
    leap: { strideSeconds: 0, dipSeconds: 0.1, takeoffSpeed: 4.9 },
    setHeight: 2.05,
    twoFooted: false,
    label: 'FINGER ROLL',
  },
  reverse: {
    leap: { strideSeconds: 0, dipSeconds: 0.1, takeoffSpeed: 4.9 },
    setHeight: 2.05,
    twoFooted: false,
    label: 'REVERSE',
  },
  power: {
    // The longer dip IS the jump stop: you gather both feet and plant
    // before going up, rather than running straight into the jump.
    leap: { strideSeconds: 0, dipSeconds: 0.18, takeoffSpeed: 3.9 },
    setHeight: 1.95,
    twoFooted: true,
    label: 'POWER',
  },
  dunk: {
    leap: { strideSeconds: 0, dipSeconds: 0.1, takeoffSpeed: 4.9 },
    setHeight: 2.05,
    twoFooted: false,
    label: 'DUNK',
  },
};

/**
 * Seconds from the button going down to the legs firing - the strides
 * and then the plant. Everything about the jump is measured from here,
 * so adding stride time to a shot moves its whole airborne half along
 * with it rather than quietly shortening the jump.
 */
export function shotTakeoffSeconds(leap: ShotLeap): number {
  return leap.strideSeconds + leap.dipSeconds;
}

/** Height off the floor at `elapsed` seconds into the shot motion - a real ballistic arc, not a curve fitted to charge progress. */
export function shotLift(elapsedSeconds: number, leap: ShotLeap): number {
  const t = elapsedSeconds - shotTakeoffSeconds(leap);
  if (t <= 0) return 0;
  return Math.max(0, leap.takeoffSpeed * t - 0.5 * SHOT_JUMP_GRAVITY * t * t);
}

/** Seconds from the button going down to the top of the jump. */
export function shotApexSeconds(leap: ShotLeap): number {
  return shotTakeoffSeconds(leap) + leap.takeoffSpeed / SHOT_JUMP_GRAVITY;
}

/** Seconds from the button going down to the shooter's feet being back on the floor. */
export function shotLandingSeconds(leap: ShotLeap): number {
  return shotTakeoffSeconds(leap) + (2 * leap.takeoffSpeed) / SHOT_JUMP_GRAVITY;
}

/**
 * How far into the shot a given fraction of the RISE is, in seconds -
 * where the rise runs from the last gather stride to the top of the
 * jump, not from the button going down.
 *
 * Release timings are fractions of the rise because that is what they
 * mean: a layup lets go a bit past halfway up. Measuring them from the
 * button instead would make a shot with stride time in front of it
 * release earlier in its own jump the longer its gather is, which is
 * backwards.
 */
export function shotRiseSeconds(leap: ShotLeap, fraction: number): number {
  return leap.strideSeconds + (shotApexSeconds(leap) - leap.strideSeconds) * fraction;
}

/** Everything but a jump shot is a finish: no release timing, the motion commits and plays itself out. */
export function isFinish(style: ShotStyle): boolean {
  return style !== 'jumper';
}

/** The three that are put down from above the rim rather than shot at it. */
export function isDropFinish(style: ShotStyle): boolean {
  return style === 'dunk' || style === 'fingerRoll' || style === 'reverse';
}
