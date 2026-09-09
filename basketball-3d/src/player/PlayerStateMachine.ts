/**
 * Phase 1 of the gameplay-systems spec: a single authoritative record of
 * what the player is currently doing, replacing the scattered booleans
 * (hasBall, moves.isActive, shooting.state === 'charging', ...) that
 * PlayerController already reads to make its own decisions. This class
 * doesn't change any of those decisions - it observes the same signals
 * PlayerController already computes and labels them, so nothing about
 * the tuned dribble/shoot/pass behavior built up over this project
 * changes. What it adds: one place other systems (the debug HUD now,
 * animation/combo/stamina systems in later phases) can ask "what state
 * is the player in, and how long have they been in it" without each
 * reimplementing that inference.
 *
 * States are the full roster the spec calls for (spec section 2),
 * including several - JUMP/LAND, LAYUP family, DUNK, STEAL/BLOCK/
 * CONTEST/BOX_OUT/REBOUND/STAGGER/STUNNED - that aren't reachable yet
 * because the gameplay behind them doesn't exist (no jump input is
 * wired, no defender/AI exists to contest or be stolen from). Keeping
 * them as valid enum members now, per spec section 73's "a new move
 * should be addable without rewriting," means later phases can start
 * entering them without touching this file's type.
 */
export type PlayerState =
  // locomotion - no special action in progress
  | 'idle'
  | 'walk'
  | 'run'
  | 'sprint'
  | 'turn'
  | 'jump'
  | 'land'
  // on-ball
  | 'tripleThreat'
  | 'dribbling'
  // dribble moves - named to match DribbleMoveSystem's DribbleMoveType
  // where one already exists, so there's no separate translation layer
  | 'crossover'
  | 'legsThrough'
  | 'behindBack'
  | 'hesitation'
  | 'inAndOut'
  | 'spin'
  | 'stepback'
  // shooting
  | 'gather'
  | 'shooting'
  | 'release'
  | 'followThrough'
  // finishing
  | 'layup'
  | 'reverseLayup'
  | 'floater'
  | 'dunk'
  // passing
  | 'pass'
  | 'catch'
  // defense / contact
  | 'steal'
  | 'block'
  | 'contest'
  | 'boxOut'
  | 'rebound'
  | 'stagger'
  | 'stunned';

/**
 * Whether PlayerMovement's live input should drive the player while in a
 * given state. (Ball ownership used to live here too, as a parallel,
 * looser categorization - moved to BallOwnershipTracker in
 * BallOwnership.ts, phase 2, so there's exactly one authoritative record
 * of who holds the ball instead of two that could drift apart.)
 */
export type LocomotionMode = 'free' | 'reduced' | 'locked';

export interface StateMeta {
  locomotion: LocomotionMode;
}

const DEFAULT_META: StateMeta = { locomotion: 'free' };

/**
 * Metadata for the states actually reachable today. Deliberately not
 * exhaustive - states with no gameplay behind them yet (dunk, steal,
 * block, ...) would just be guessed-at numbers with nothing to verify
 * them against, so they fall through to DEFAULT_META until the phase
 * that implements them fills in real values.
 *
 * `locomotion` is descriptive, not enforced yet: PlayerController does
 * not currently gate movement input off of it (that lands with the
 * phases that actually build out crossover/etc. as real momentum-driven
 * moves) - it's here so those phases, and the debug HUD, have something
 * real to read starting now instead of retrofitting it later.
 */
const STATE_META: Partial<Record<PlayerState, StateMeta>> = {
  crossover: { locomotion: 'reduced' },
  legsThrough: { locomotion: 'reduced' },
  hesitation: { locomotion: 'reduced' },
  inAndOut: { locomotion: 'reduced' },
  stepback: { locomotion: 'reduced' },
  gather: { locomotion: 'locked' },
  shooting: { locomotion: 'locked' },
  release: { locomotion: 'locked' },
};

export class PlayerStateMachine {
  current: PlayerState = 'idle';
  previous: PlayerState | null = null;
  timeInState = 0;

  /** Switches state if different; a same-state call is a no-op (doesn't reset the timer). */
  enter(state: PlayerState): void {
    if (state === this.current) return;
    this.previous = this.current;
    this.current = state;
    this.timeInState = 0;
  }

  /** Call once per fixed physics step. */
  update(dt: number): void {
    this.timeInState += dt;
  }

  get meta(): StateMeta {
    return STATE_META[this.current] ?? DEFAULT_META;
  }
}
