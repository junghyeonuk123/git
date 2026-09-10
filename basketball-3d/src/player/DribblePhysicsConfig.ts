/**
 * Dribble tuning: every number the dribble loop reads, in one place so
 * feel can be retuned without touching DribbleSystem.ts's logic.
 *
 * See DribbleSystem.ts's header for why the shape of these changed: the
 * ball is no longer steered at the floor at all, so what used to be
 * bounce-solver tuning is now hand-contact tuning.
 */
export const DribblePhysicsConfig = {
  /**
   * Hand height (meters above the floor) for each dribble stance - the
   * height the ball is driven back up to, and where the hand waits for
   * it. Low and tight while sprinting (ball security over control),
   * higher and more relaxed while set in triple threat.
   */
  dribbleHeightLow: 0.5, // sprint dribble
  dribbleHeightNormal: 0.66, // walking/standard dribble
  dribbleHeightHigh: 0.76, // triple-threat, more control

  /**
   * How far (meters, horizontally) the hand can be from the ball and
   * still get a push on it. Beyond this the player simply misses the
   * ball this cycle and it keeps bouncing wherever its own momentum was
   * already taking it - which is the entire point of the rewrite.
   */
  handReach: 1.4,

  /** The ball must be at least this high to be pushable - below it the hand has nothing to push against. */
  minPushHeight: 0.17,

  /** Only push once the ball has stopped rising (m/s of upward velocity still tolerated), i.e. as it settles into the pocket. */
  apexWindow: 0.3,

  /** Don't push while the ball is still well above the hand - wait for it to come down into the pocket. */
  pocketWindow: 0.28,

  /** Seconds between pushes, so one contact can't fire on consecutive steps. */
  pushCooldown: 0.15,

  /**
   * Change in the handler's intended velocity (m/s) that counts as
   * starting a cut, and earns an immediate extra push if the hand can
   * still reach the ball.
   *
   * Without this the dribble was a coin flip on every drive. A push
   * leaves the ball with whatever velocity the player had AT THAT
   * INSTANT, and it is then untouchable for a whole bounce - so taking
   * off a moment after a push meant the ball stayed exactly where it
   * was while the player accelerated 1.4m away, which is past any
   * plausible reach, and the dribble was simply gone. Take off a moment
   * BEFORE a push and everything was fine. That is not a tuning problem,
   * it is a missing beat: a real handler starts a drive BY pushing the
   * ball out ahead of themselves, they do not wait for the bounce to
   * come round.
   */
  cutPushThreshold: 1.2,

  /**
   * Seconds a cut stays "armed" waiting for the hand to be able to reach
   * the ball. The intent changes on a single physics step, but the ball
   * may be down at the floor on exactly that step and untouchable - so
   * arming it and taking the first chance that comes, rather than
   * demanding the two coincide, is the difference between the drive
   * working and the ball being abandoned.
   */
  cutPushWindow: 0.3,

  /**
   * Effective ball/court bounce, used to work out how hard to push so
   * the ball comes back up to hand height. Only an estimate - Rapier's
   * own combined restitution is what actually runs - but the push is
   * recomputed from the ball's real height every cycle, so any error
   * self-corrects on the very next push rather than accumulating.
   */
  floorRestitution: 0.6,

  /** Clamps on the downward push, m/s. */
  minPushSpeed: 1.6,
  maxPushSpeed: 7,

  /**
   * m/s cap on the recentering half of a push - the part that eases the
   * ball back under the hand, on top of the player's own velocity which
   * the ball inherits. Kept small: at push time the ball is already
   * within handReach, so during ordinary dribbling the gap - and with it
   * this term - is near zero and the ball is moved by the player's own
   * velocity alone. It only becomes significant when the handler is
   * genuinely corralling a ball that got away on a cut, which is exactly
   * when a real handler reaches out and hauls it back.
   */
  maxRecenter: 2.6,

  /**
   * Horizontal distance (meters) at which the handler has simply lost
   * the ball. Without this the player could stroll away from a bouncing
   * ball and still be holding it - the "pet following the player" look
   * in its purest form. Generous enough that ordinary cuts recover.
   */
  loseDistance: 2.6,
} as const;
