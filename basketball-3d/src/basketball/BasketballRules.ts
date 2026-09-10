import * as THREE from 'three';
import { CourtDimensions as CD } from './CourtDimensions';
import type { Hoop } from './Hoop';
import type { ShotResult } from '@/player/ShootingSystem';

const QUARTER_SECONDS = 12 * 60;
const SHOT_CLOCK_SECONDS = 24;
/** Rule 7-Section IV-4-1: reset (not just resumed) to 14 when the offensive player is first to gain possession after their own missed attempt that touched the rim. */
const SHOT_CLOCK_REBOUND_SECONDS = 14;
const PAINT_VIOLATION_SECONDS = 3;
const TOTAL_QUARTERS = 4;

export type ViolationType = 'shotClock' | 'threeSeconds' | 'outOfBounds' | 'basketSupport';

export interface GameEvent {
  kind: 'score' | 'violation' | 'quarterEnd' | 'gameEnd';
  detail: string;
  at: number; // rules-clock seconds elapsed, for UI fade timing keyed off something stable
}

/**
 * The rule engine spec sections 8/9 ask for: real scoring-volume
 * detection (not "ball near rim = score"), a game/shot clock, and a
 * subset of violations that are actually meaningful without a defense
 * to foul or contest anything (Phase 5). Personal/shooting/blocking
 * fouls all require contact with a second player, so this intentionally
 * does not implement them yet - RuleConfig below exists so they can be
 * flagged in once defenders exist, without changing this file's shape.
 * Traveling/double-dribble/carrying are also deferred: judging them
 * correctly needs real foot-plant and ball-control state this project's
 * animation system doesn't track yet, and a rule that misfires constantly
 * would be worse than not having it.
 */
export const RuleConfig = {
  scoring: true,
  shotClock: true,
  threeSecondViolation: true,
  outOfBounds: true,
  fouls: false, // needs a defender (Phase 5)
  travelingAndDribbleViolations: false, // needs real foot/ball-control tracking
} as const;

interface PendingShot {
  hoop: Hoop;
  points: 2 | 3;
  prevBallX: number;
  prevBallY: number;
  prevBallZ: number;
  /** Set by notifyRimContact() - distinguishes a real miss (rule 7-IV-4-1, resets to 14) from an airball that never touched iron (rule 7-IV-2-5, no reset at all). */
  touchedRim: boolean;
}

export class BasketballRules {
  score = 0;
  quarter = 1;
  quarterClock = QUARTER_SECONDS;
  shotClock = SHOT_CLOCK_SECONDS;
  running = true;
  lastEvent: GameEvent | null = null;
  lastViolationType: ViolationType | null = null;

  private paintClock = 0;
  private pendingShot: PendingShot | null = null;
  /** Rule 4-Section III-1-a-i: a field goal already in flight when the clock hits :00.0 still gets to finish. */
  private periodEndPending = false;
  /** Set when a missed shot that touched the rim resolves, consumed on the next hasBall false->true transition. */
  private reboundBonusPending = false;
  private prevHasBall = true;
  private elapsed = 0;
  /** Set for one fixedUpdate call when a violation/turnover should hand the ball back. */
  turnoverRequested = false;

  /** Call right after ShootingSystem.release() succeeds. */
  beginShotAttempt(result: ShotResult, ballPosition: THREE.Vector3): void {
    this.pendingShot = {
      hoop: result.targetHoop,
      points: result.points,
      prevBallX: ballPosition.x,
      prevBallY: ballPosition.y,
      prevBallZ: ballPosition.z,
      touchedRim: false,
    };
  }

  /** Call from Game.ts whenever the physics step reports a ball/rim collision starting. */
  notifyRimContact(): void {
    if (this.pendingShot) this.pendingShot.touchedRim = true;
  }

  /**
   * Rule 8-Section II-1: the ball is out-of-bounds the instant it touches
   * "the supports ... of the backboard" - contact with the pole (and, if
   * they ever get their own colliders, the arm/bracket) is a dead ball,
   * not just a legal bounce off one more piece of court furniture.
   */
  notifyBasketSupportContact(): void {
    this.callViolation('basketSupport', 'Hit the basket support - dead ball');
  }

  /** Call once per fixed physics step. */
  update(dt: number, ballPosition: THREE.Vector3, hasBall: boolean): void {
    this.turnoverRequested = false;
    if (!this.running) return;
    this.elapsed += dt;

    if (hasBall && !this.prevHasBall && this.reboundBonusPending) {
      this.shotClock = SHOT_CLOCK_REBOUND_SECONDS;
      this.reboundBonusPending = false;
    }
    this.prevHasBall = hasBall;

    this.updateClock(dt);
    if (RuleConfig.shotClock) this.updateShotClock(dt, hasBall);
    if (RuleConfig.threeSecondViolation) this.updatePaintViolation(dt, ballPosition, hasBall);
    if (RuleConfig.outOfBounds) this.checkOutOfBounds(ballPosition);
    if (RuleConfig.scoring) this.checkScoring(ballPosition);
  }

  private updateClock(dt: number): void {
    if (this.periodEndPending) {
      // Holding at :00.0 until checkScoring resolves the in-flight shot
      // (scored, or missed and back on the floor) - see its own comment.
      if (!this.pendingShot) this.finishPeriod();
      return;
    }
    if (this.quarterClock <= 0) return;
    this.quarterClock = Math.max(0, this.quarterClock - dt);
    if (this.quarterClock === 0) {
      if (this.pendingShot) {
        this.periodEndPending = true;
      } else {
        this.finishPeriod();
      }
    }
  }

  private finishPeriod(): void {
    this.periodEndPending = false;
    if (this.quarter >= TOTAL_QUARTERS) {
      this.running = false;
      this.emit('gameEnd', `Final score: ${this.score}`);
    } else {
      this.quarter += 1;
      this.quarterClock = QUARTER_SECONDS;
      this.resetShotClock();
      this.emit('quarterEnd', `Start of Q${this.quarter}`);
    }
  }

  private updateShotClock(dt: number, hasBall: boolean): void {
    // Paused while the ball is airborne (mid-shot/pass) or loose, same as
    // real shot-clock behavior stopping only for specific dead-ball
    // reasons - here, simply "nobody is actively possessing it yet".
    if (!hasBall) return;
    this.shotClock = Math.max(0, this.shotClock - dt);
    if (this.shotClock === 0) {
      this.callViolation('shotClock', 'Shot clock violation');
    }
  }

  private updatePaintViolation(dt: number, ballPosition: THREE.Vector3, hasBall: boolean): void {
    const inPaint = hasBall && isInAnyPaint(ballPosition);
    this.paintClock = inPaint ? this.paintClock + dt : 0;
    if (this.paintClock > PAINT_VIOLATION_SECONDS) {
      this.paintClock = 0;
      this.callViolation('threeSeconds', '3 seconds in the paint');
    }
  }

  private checkOutOfBounds(ballPosition: THREE.Vector3): void {
    const margin = 0.05;
    const outOfBounds =
      Math.abs(ballPosition.x) > CD.length / 2 + margin || Math.abs(ballPosition.z) > CD.width / 2 + margin;
    // Only a ball that has actually come down near the floor out there
    // counts - a three-point arc legitimately passes over the sideline
    // area while still high in the air.
    if (outOfBounds && ballPosition.y < 0.5) {
      this.callViolation('outOfBounds', 'Out of bounds');
    }
  }

  private checkScoring(ballPosition: THREE.Vector3): void {
    const pending = this.pendingShot;
    if (!pending) return;

    const hoop = pending.hoop;
    const crossedDown = pending.prevBallY > hoop.rimCenter.y && ballPosition.y <= hoop.rimCenter.y;
    // A ball's center can physically pass through the rim opening anywhere
    // up to (rim radius - ball radius) from the axis - that's the true
    // geometric tolerance, not an arbitrarily shrunk one; real rim/net
    // collision (Hoop.ts) already governs whether it actually gets there
    // clean. Interpolate the crossing point rather than using this step's
    // post-crossing position, since a fast-falling ball can move several
    // centimeters in one physics step.
    const denom = pending.prevBallY - ballPosition.y;
    const t = denom > 1e-6 ? (pending.prevBallY - hoop.rimCenter.y) / denom : 1;
    const crossX = THREE.MathUtils.lerp(pending.prevBallX, ballPosition.x, t);
    const crossZ = THREE.MathUtils.lerp(pending.prevBallZ, ballPosition.z, t);
    const horizDist = Math.hypot(crossX - hoop.rimCenter.x, crossZ - hoop.rimCenter.z);
    const scoringRadius = CD.hoop.rimRadius - CD.ball.radius;

    if (crossedDown && horizDist < scoringRadius) {
      this.score += pending.points;
      this.resetShotClock();
      this.emit('score', `${pending.points === 3 ? '3-POINTER' : 'Basket'}! +${pending.points}`);
      this.pendingShot = null;
      return;
    }
    pending.prevBallX = ballPosition.x;
    pending.prevBallY = ballPosition.y;
    pending.prevBallZ = ballPosition.z;

    // A shot that comes back down to the floor without going in has
    // missed - this attempt is decided either way, which matters for the
    // buzzer-beater case above (a shot can only hold the period open
    // while it's still genuinely unresolved) and also stops a stale
    // miss from ever being re-evaluated against a later, unrelated
    // bounce near this same hoop.
    if (ballPosition.y <= CD.ball.radius + 0.05) {
      if (pending.touchedRim) this.reboundBonusPending = true;
      this.pendingShot = null;
    }
  }

  private callViolation(type: ViolationType, message: string): void {
    this.lastViolationType = type;
    this.turnoverRequested = true;
    this.pendingShot = null;
    this.reboundBonusPending = false;
    this.resetShotClock();
    this.emit('violation', message);
  }

  private resetShotClock(): void {
    this.shotClock = SHOT_CLOCK_SECONDS;
  }

  private emit(kind: GameEvent['kind'], detail: string): void {
    this.lastEvent = { kind, detail, at: this.elapsed };
  }
}

function isInAnyPaint(point: THREE.Vector3): boolean {
  for (const side of [1, -1] as const) {
    const baselineX = side * (CD.length / 2);
    const nearX = Math.min(baselineX, baselineX - side * CD.paint.length);
    const farX = Math.max(baselineX, baselineX - side * CD.paint.length);
    if (point.x >= nearX && point.x <= farX && Math.abs(point.z) <= CD.paint.width / 2) {
      return true;
    }
  }
  return false;
}
