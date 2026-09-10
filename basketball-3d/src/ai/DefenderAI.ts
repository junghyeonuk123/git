import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import type { Hoop } from '@/basketball/Hoop';
import type { Ball } from '@/basketball/Ball';
import { Player } from '@/player/Player';
import { PlayerMovement } from '@/player/PlayerMovement';
import type { PlayerController } from '@/player/PlayerController';
import { nearestHoop } from '@/player/ShootingSystem';

/** How far off the attacker's hip the defender tries to sit - roughly arm's length, between the attacker and the basket they're attacking. */
const GUARD_DISTANCE = 1.15;
/** Beyond this gap to its target spot, the defender sprints to close it; inside it, a walk reads as a controlled guarding shuffle rather than a dash. */
const SPRINT_CLOSE_DISTANCE = 2.5;
/**
 * Arm's reach for a steal poke, measured to the ball itself. Bigger than
 * a literal arm length: GUARD_DISTANCE is body-to-body, and the ball
 * sits offset from the attacker's body toward the dribbling hand, so at
 * a normal guarding distance the ball is typically already close to
 * 1.5m+ from the defender even when their positioning is textbook -
 * confirmed empirically (a defender parked at GUARD_DISTANCE saw the
 * ball sit at ~1.5-1.6m throughout a stationary dribble). Tuned to make
 * a reach-in a real possibility at normal guarding range, not just when
 * a move happens to swing the ball unusually wide.
 */
const STEAL_REACH = 1.6;
/** The ball has to actually be away from the attacker's hand (mid-bounce) for a poke to make sense - a bounce apex/floor contact isn't a reachable target. */
const STEAL_MIN_HAND_DISTANCE = 0.45;
/** Roughly the fraction of a sustained one-second reach that connects - tuned to feel occasional, not automatic. */
const STEAL_CHANCE_PER_SECOND = 0.9;
/** After any steal roll (hit or miss), a short pause before the next one - keeps deflections from firing every single tick a defender is in range. */
const STEAL_ROLL_COOLDOWN = 0.35;
const DEFENDER_JERSEY_COLOR = 0xb43226;

const scratchDir = new THREE.Vector2();
const scratchGuardSpot = new THREE.Vector3();

/**
 * Phase 1 of a defender: a single AI-controlled opponent that shadows the
 * ball handler and can poke a live dribble loose. Deliberately narrow in
 * scope - this is the first slice of the "input + state + physics +
 * momentum + defender position = gameplay result" design the reference
 * material argues for, not the whole defensive system in one pass:
 *
 * - Guarding position only (no on-ball pressure forcing a pick a
 *   direction, no help defense, no screens).
 * - Steal/deflection on an exposed dribble only - no blocks, no box-out
 *   rebounding, no fouls (this project still has no foul system at all;
 *   see BasketballRules.RuleConfig.fouls).
 * - No shot contest effect on shooting accuracy yet.
 *
 * These are real, deliberately deferred next phases, not oversights -
 * the reference material's own phased-development rule (build one
 * playable slice, verify it, then extend) applies here same as anywhere
 * else in this project.
 */
export class DefenderAI {
  readonly player: Player;
  private readonly movement = new PlayerMovement();
  private stealCooldown = 0;

  /** Debug/inspection only. */
  private lastDistanceToBall = 0;
  private lastTargetSpot = new THREE.Vector3();

  constructor(scene: THREE.Scene, physics: PhysicsWorld, spawn: THREE.Vector3) {
    this.player = new Player(scene, physics, spawn, DEFENDER_JERSEY_COLOR);
  }

  fixedUpdate(
    dt: number,
    attacker: Player,
    ball: Ball,
    hoops: readonly Hoop[],
    playerController: PlayerController,
  ): void {
    this.stealCooldown = Math.max(0, this.stealCooldown - dt);

    const attackerPos = attacker.position;
    const targetHoop = nearestHoop(hoops, attackerPos);
    scratchGuardSpot
      .copy(targetHoop.rimCenter)
      .sub(attackerPos)
      .setY(0)
      .normalize()
      .multiplyScalar(GUARD_DISTANCE)
      .add(attackerPos);
    this.lastTargetSpot.copy(scratchGuardSpot);

    const selfPos = this.player.position;
    scratchDir.set(scratchGuardSpot.x - selfPos.x, scratchGuardSpot.z - selfPos.z);
    const distToSpot = scratchDir.length();
    if (distToSpot > 1e-4) scratchDir.multiplyScalar(1 / distToSpot);

    const sprint = distToSpot > SPRINT_CLOSE_DISTANCE;
    const displacement = this.movement.steerToward(scratchDir, sprint, dt);
    this.player.applyMovement(displacement, dt);
    // Always face the ball handler - a real defender backpedals/shuffles
    // rather than turning their back to track a guarding spot, which is
    // what following movement.facingYaw (built for a forward-facing
    // human-controlled player) would otherwise produce.
    const toAttacker = new THREE.Vector3().subVectors(attackerPos, selfPos);
    if (toAttacker.lengthSq() > 1e-6) {
      this.player.setFacing(Math.atan2(toAttacker.x, toAttacker.z));
    }

    this.tryStealAttempt(ball, playerController);
  }

  /**
   * A steal is only a live possibility during the genuine free-flight
   * portion of a dribble - the same window DribbleSystem's own
   * handDistance already tracks (see that class's header comment on why
   * hand-ball distance has to visibly vary at all). Reusing it here
   * rather than inventing a second notion of "is the ball exposed" keeps
   * this system honest about the one thing that actually makes a steal
   * possible: physically reaching a ball that is not, this instant, in
   * the attacker's hand.
   */
  private tryStealAttempt(ball: Ball, playerController: PlayerController): void {
    this.lastDistanceToBall = this.player.position.distanceTo(ball.position);
    if (!playerController.hasBall) return;
    if (playerController.dribble.handDistance < STEAL_MIN_HAND_DISTANCE) return;
    if (this.lastDistanceToBall > STEAL_REACH) return;
    if (this.stealCooldown > 0) return;

    this.stealCooldown = STEAL_ROLL_COOLDOWN;
    // One roll per cooldown window, so the per-roll chance is scaled by
    // the cooldown length (how much eligible time this roll covers), not
    // the physics tick - rolls don't happen every tick.
    if (Math.random() >= STEAL_CHANCE_PER_SECOND * STEAL_ROLL_COOLDOWN) return;

    this.deflectBall(ball, playerController);
  }

  private deflectBall(ball: Ball, playerController: PlayerController): void {
    const away = new THREE.Vector3().subVectors(ball.position, this.player.position);
    away.y = 0;
    if (away.lengthSq() < 1e-6) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    away.normalize();

    // A poke, not a launch: this should knock the ball a believable
    // couple of meters away for a scramble, not send it flying across
    // the court. Verified live - the first tuning (3.5 lateral, 1.5
    // minimum lift, 30% of incoming velocity kept) sent the ball 15+
    // meters off in a straight line with nothing to bring it back.
    const incoming = ball.linearVelocity;
    const deflected = new THREE.Vector3(
      incoming.x * 0.15 + away.x * 2.0,
      Math.max(incoming.y, 0.8),
      incoming.z * 0.15 + away.z * 2.0,
    );
    ball.body.setLinvel(deflected, true);
    playerController.forceLoseBall();
  }

  syncFromPhysics(): void {
    this.player.syncFromPhysics();
  }

  updateVisuals(dt: number): void {
    this.player.updateWalkCycle(this.movement.speed, dt, 0);
  }

  /** Debug panel only. */
  get debugState(): { distanceToBall: number; targetSpot: THREE.Vector3; stealCooldown: number } {
    return { distanceToBall: this.lastDistanceToBall, targetSpot: this.lastTargetSpot, stealCooldown: this.stealCooldown };
  }
}
