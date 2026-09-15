/**
 * What kind of shot is being taken, and the leap that goes with it.
 *
 * This lives in its own module because both halves of a shot need it and
 * neither should own it: Player.ts drives the body's pose from the leap,
 * ShootingSystem.ts drives the ball's height from the same leap, and
 * they have to agree exactly or the ball and the hands come apart in
 * mid-air. One definition, imported by both.
 */

export type ShotStyle = 'jumper' | 'layup' | 'dunk';

export interface ShotLeap {
  /** Seconds spent sinking into the load before the legs fire. */
  dipSeconds: number;
  /**
   * Takeoff speed, m/s. Everything else about the jump - apex height,
   * time to the apex, hang time - follows from this and gravity rather
   * than being authored separately, which is what keeps the motion at
   * gravity's pace instead of an animator's.
   */
  takeoffSpeed: number;
}

const SHOT_JUMP_GRAVITY = 9.81;

/**
 * Apex heights fall out as v^2/2g:
 *
 *   jumper  0.25m, at 0.37s, feet down at 0.60s
 *   layup   0.90m, at 0.53s, feet down at 0.96s
 *   dunk    1.22m, at 0.60s, feet down at 1.10s
 *
 * The dunk's 1.22m is high for a vertical leap, and it is set by the rig
 * rather than by taste: this character's shoulder is at 1.55m with a
 * 0.50m arm, so its overhead reach is only about 2.05m where a real
 * player of the same height reaches nearer 2.6m. The hand still has to
 * clear a 3.05m rim, so the legs have to make up what the arms do not.
 */
export const SHOT_LEAPS: Record<ShotStyle, ShotLeap> = {
  jumper: { dipSeconds: 0.15, takeoffSpeed: 2.2 },
  layup: { dipSeconds: 0.1, takeoffSpeed: 4.2 },
  dunk: { dipSeconds: 0.1, takeoffSpeed: 4.9 },
};

/** Height off the floor at `elapsed` seconds into the shot motion - a real ballistic arc, not a curve fitted to charge progress. */
export function shotLift(elapsedSeconds: number, leap: ShotLeap): number {
  const t = elapsedSeconds - leap.dipSeconds;
  if (t <= 0) return 0;
  return Math.max(0, leap.takeoffSpeed * t - 0.5 * SHOT_JUMP_GRAVITY * t * t);
}

/** Seconds from the button going down to the top of the jump. */
export function shotApexSeconds(leap: ShotLeap): number {
  return leap.dipSeconds + leap.takeoffSpeed / SHOT_JUMP_GRAVITY;
}

/** Seconds from the button going down to the shooter's feet being back on the floor. */
export function shotLandingSeconds(leap: ShotLeap): number {
  return leap.dipSeconds + (2 * leap.takeoffSpeed) / SHOT_JUMP_GRAVITY;
}

/** A layup and a dunk are finishes at the rim: no release timing, the motion commits and plays out. */
export function isFinish(style: ShotStyle): boolean {
  return style !== 'jumper';
}
