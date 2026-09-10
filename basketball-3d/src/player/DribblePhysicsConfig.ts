/**
 * Dribble-physics tuning spec section 53: every number the dribble bounce
 * loop reads pulled into one place instead of scattered module constants,
 * so a designer can retune feel without hunting through DribbleSystem.ts's
 * logic. Values are unchanged from what was already tuned and verified in
 * DribbleSystem.ts - this is a pure extraction, not a retune.
 */
export const DribblePhysicsConfig = {
  /**
   * Bounce apex height (meters above the floor) for each dribble stance.
   * Lowered across the board to match real footage, where a handler in a
   * low stance keeps the ball around thigh height rather than up at the
   * waist - and lowered again relative to the player because the stance
   * itself now sits the body noticeably lower (see Player's CROUCH_*).
   */
  dribbleHeightLow: 0.5, // sprint dribble - tight and low, ball security over control
  dribbleHeightNormal: 0.66, // walking/standard dribble
  dribbleHeightHigh: 0.76, // triple-threat, more control

  /**
   * m/s cap on the *convergence* half of a bounce's horizontal velocity -
   * the part that pulls the ball back under the hand, on top of the
   * player's own velocity which the ball inherits outright. Capping this
   * (rather than the total, which is what the old maxHorizontalCorrection
   * did at 9 m/s) is what stops the ball being flung sideways to chase
   * the hand through a direction change. Sized so one bounce closes a
   * bit under a meter: enough to recover from a normal cut within a
   * bounce or two, nowhere near enough to look magnetic.
   */
  maxHandConvergence: 2.4,

  /** Meters above the floor the "bounce" trigger arms within. */
  contactTolerance: 0.05,

  /** Seconds - debounces re-triggering a bounce while the ball lingers near the floor. */
  bounceCooldown: 0.2,

  /** Bounce rises just short of hand height (fraction of hand-to-floor distance), like a real catch rather than a wall-bounce overshoot. */
  bounceHeightFactor: 0.92,

  /**
   * Blend against the ball's own incoming velocity at each bounce, 0..1.
   * Only guards the single-bounce instant-180-reversal edge case - kept
   * small deliberately, since a larger value is what previously made the
   * ball visibly trail the player during ordinary movement (see
   * DribbleSystem.ts's header comment for the full story).
   */
  movementInfluence: 0.2,
} as const;
