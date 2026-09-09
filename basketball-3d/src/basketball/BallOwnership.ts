import type { Ball } from './Ball';

/**
 * Gameplay-systems spec phase 2: an explicit, single-source-of-truth
 * record of which system is currently authoritative over the ball's
 * position, matching spec section 3's mode list (BALL_IN_DRIBBLE folds
 * into controlledLeft/Right here - in this project a dribble *is* a hand
 * controlling the ball, not a distinct ownership mode from it).
 *
 * This project was already structurally safe against the failure spec
 * section 3 warns about (ball fought over by physics/animation/IK at
 * once): PlayerController.handlePossession is one if/else chain with
 * early returns, so only one of DribbleSystem/ShootingSystem/
 * PassingSystem ever touches the ball in a given tick, and only Ball.ts
 * itself flips the underlying Rapier body between kinematic (held) and
 * dynamic (physics-driven). What that arrangement lacked was somewhere
 * to *see* the current authority as one value, and something later
 * phases (rebound/steal/block, where an attacker's hand, a defender's
 * hand, and physics can plausibly all want the ball in the same tick)
 * can hand a claim to instead of re-deriving "who owns this" from
 * scratch. That's what this class is for.
 */
export type BallOwnershipMode =
  | 'free'
  | 'controlledLeft'
  | 'controlledRight'
  | 'gather'
  | 'shot'
  | 'pass'
  | 'dunk'
  | 'rebound';

export type BallOwner = 'none' | 'dribble' | 'shooting' | 'passing';

/** Whether the ball's Rapier body is expected to be kinematic (held) or dynamic (physics-driven) in a given mode. */
function expectedKinematic(mode: BallOwnershipMode): boolean {
  return mode === 'gather';
}

export class BallOwnershipTracker {
  current: BallOwnershipMode = 'free';
  owner: BallOwner = 'none';

  /** Called by PlayerController at each of its existing possession decision points. */
  claim(mode: BallOwnershipMode, owner: BallOwner): void {
    this.current = mode;
    this.owner = owner;
  }

  /**
   * Dev-diagnostic only: cross-checks the claimed mode against the ball's
   * actual physics body type, so a real desync (the exact bug spec
   * section 3 warns about) would show up here instead of silently
   * producing a glitchy ball. Returns null when consistent.
   */
  checkConsistency(ball: Ball): string | null {
    const expected = expectedKinematic(this.current);
    if (ball.isKinematic !== expected) {
      return `ballOwnership='${this.current}' expects kinematic=${expected} but ball.isKinematic=${ball.isKinematic}`;
    }
    return null;
  }
}
