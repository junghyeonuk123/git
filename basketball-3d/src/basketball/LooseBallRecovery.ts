import * as THREE from 'three';
import type { Player } from '@/player/Player';
import type { DribbleSystem } from '@/player/DribbleSystem';
import type { Ball } from './Ball';
import { CourtDimensions as CD } from './CourtDimensions';

/** How the ball is currently moving, for debug/tuning visibility (spec section 3/10/11). */
export type LooseBallMotion = 'still' | 'rolling' | 'bouncing';

export interface RecoveryZones {
  /** Beyond this, the ball isn't a recovery candidate at all - just context for the debug panel. */
  approachRange: number;
  /** Max pickup distance for a slow/stopped ball. Shrinks toward handRange as ball speed rises. */
  recoveryRange: number;
  /** Pickup always succeeds this close, regardless of facing - the ball is basically at the player's feet/hands. */
  handRange: number;
}

export const DEFAULT_RECOVERY_ZONES: RecoveryZones = {
  approachRange: 2.0,
  recoveryRange: 1.0,
  handRange: 0.4,
};

const FAST_SPEED_REF = 5; // m/s - ball speed at which the effective pickup window has shrunk all the way to handRange
const MAX_GRABBABLE_HEIGHT = 1.3; // meters above the floor - higher than this needs a jump/catch, not a ground pickup
const FACING_DOT_MIN = -0.2; // outside handRange, the ball can't be badly behind the player
const GRAB_DURATION = 0.15; // seconds - the brief hybrid interval spec section 17 asks for instead of an instant snap

/** Classifies how the ball is currently moving, purely for tuning/debug (spec sections 3/10/11). */
export function classifyBallMotion(ball: Ball): LooseBallMotion {
  const v = ball.linearVelocity;
  if (v.lengthSq() < 0.0025) return 'still';
  const floorY = CD.ball.radius;
  const onFloor = ball.position.y <= floorY + 0.05;
  return onFloor && Math.abs(v.y) < 0.3 ? 'rolling' : 'bouncing';
}

const scratchCheck = new THREE.Vector3();

/**
 * The same gating LooseBallRecoverySystem.update() uses to decide whether
 * to begin a grab, factored out as a pure read-only check so the "PICK
 * UP" UI prompt (spec section 34) can ask "would this succeed right now"
 * every render frame without it costing a state mutation or being a
 * second, potentially-drifting copy of the real rule.
 */
export function isRecoverable(player: Player, ball: Ball, zones: RecoveryZones = DEFAULT_RECOVERY_ZONES): boolean {
  const ballPos = ball.position;
  const ballHeight = ballPos.y - CD.ball.radius;
  if (ballHeight > MAX_GRABBABLE_HEIGHT) return false;

  scratchCheck.set(ballPos.x - player.position.x, 0, ballPos.z - player.position.z);
  const dist = scratchCheck.length();
  if (dist > zones.recoveryRange) return false;

  const speedT = THREE.MathUtils.clamp(ball.linearVelocity.length() / FAST_SPEED_REF, 0, 1);
  const effectiveRange = THREE.MathUtils.lerp(zones.recoveryRange, zones.handRange, speedT);
  if (dist > effectiveRange) return false;

  if (dist > zones.handRange) {
    const dot = player.facingDirection.dot(scratchCheck.clone().normalize());
    if (dot < FACING_DOT_MIN) return false;
  }

  return true;
}

/**
 * Fixes the actual reported bug: the old recovery logic (see Game.ts's
 * previous updateLooseBallRecovery) never looked at the player at all -
 * it only handed the ball back once its speed had stayed under 0.4 m/s
 * for a full 1.2 continuous seconds, regardless of where the player was
 * standing. A player could stand right next to a moderately-fast rolling
 * ball and nothing would happen, which is exactly the video's bug.
 *
 * This replaces that with real proximity + orientation + ball-speed
 * gating (spec sections 4/8/9/21), and a brief (150ms) position-lerp
 * grab instead of an instant snap once recovery begins (spec section 17)
 * - during that window the ball is held kinematic (spec section 18's
 * "hybrid physics+IK authority"), then released back to a normal dynamic
 * body at zero velocity right at the hand, so DribbleSystem's existing
 * bounce model picks it up exactly like it does after any other handoff.
 *
 * Deliberately not implemented here (would need systems this project
 * doesn't have yet): interception prediction and movement-assist for an
 * AI-controlled chaser (there's only ever one human-controlled player),
 * defender contest, ratings/stamina influence, and a discrete 4-stage
 * reach/grab/rise animation state machine - the existing pointArmAtBall
 * IK already reaches for the ball's real position every frame, which is
 * what actually reads as "reaching," without needing new animation clips
 * this procedural rig has no equivalent of.
 */
export class LooseBallRecoverySystem {
  private grabbing = false;
  private grabTimer = 0;
  private readonly grabStart = new THREE.Vector3();
  private readonly grabTarget = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  get isRecovering(): boolean {
    return this.grabbing;
  }

  constructor(private readonly zones: RecoveryZones = DEFAULT_RECOVERY_ZONES) {}

  /** Call once per fixed step while the player doesn't have the ball. @returns whether possession was just secured this tick. */
  update(dt: number, player: Player, ball: Ball, dribble: DribbleSystem, hand: 1 | -1): boolean {
    if (this.grabbing) {
      this.grabTimer += dt;
      const t = Math.min(1, this.grabTimer / GRAB_DURATION);
      this.scratch.copy(this.grabStart).lerp(this.grabTarget, t);
      ball.setKinematicHeld(this.scratch);
      if (t < 1) return false;

      this.grabbing = false;
      ball.release(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
      return true;
    }

    if (!isRecoverable(player, ball, this.zones)) return false;

    this.grabbing = true;
    this.grabTimer = 0;
    this.grabStart.copy(ball.position);
    dribble.getHandAnchor(hand, this.grabTarget);
    return false;
  }
}
