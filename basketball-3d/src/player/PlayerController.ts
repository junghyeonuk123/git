import * as THREE from 'three';
import type { InputManager } from '@/core/InputManager';
import type { Ball } from '@/basketball/Ball';
import type { Hoop } from '@/basketball/Hoop';
import type { Player } from './Player';
import { PlayerMovement } from './PlayerMovement';
import { DribbleSystem, DRIBBLE_HEIGHT_HIGH, DRIBBLE_HEIGHT_LOW, DRIBBLE_HEIGHT_NORMAL } from './DribbleSystem';
import { DribbleMoveSystem, type DribbleMoveType } from './DribbleMoves';
import { ShootingSystem, type ShotResult } from './ShootingSystem';
import { PassingSystem } from './PassingSystem';
import { PlayerStateMachine, type PlayerState } from './PlayerStateMachine';
import { BallOwnershipTracker } from '@/basketball/BallOwnership';
import { LooseBallRecoverySystem } from '@/basketball/LooseBallRecovery';

const MOVE_ACTIONS: DribbleMoveType[] = ['crossover', 'hesitation', 'stepback', 'inAndOut', 'legsThrough'];

/**
 * Translates raw input + camera orientation into calls on Player/Movement,
 * and owns ball possession for this player: which of Dribble/Shooting/
 * Passing gets to touch the ball each step. Kept separate from Player
 * (physics body) and PlayerMovement (velocity math) so each system stays
 * single-purpose, per spec section 65's "keep gameplay logic separate
 * from visual presentation" and section 3's single-responsibility rule.
 */
export class PlayerController {
  readonly movement = new PlayerMovement();
  readonly dribble: DribbleSystem;
  readonly moves: DribbleMoveSystem;
  readonly shooting: ShootingSystem;
  readonly passing: PassingSystem;
  /** Phase 1 of the gameplay-systems spec: a single authoritative label for what the player is doing (see PlayerStateMachine.ts). */
  readonly stateMachine = new PlayerStateMachine();
  /** Phase 2: single authoritative record of which system currently owns the ball's position (see BallOwnership.ts). */
  readonly ballOwnership = new BallOwnershipTracker();
  readonly looseBallRecovery = new LooseBallRecoverySystem();

  hasBall = true;
  /** Which hand is dribbling - mutable now, since crossover/inAndOut/legsThrough switch it mid-dribble. */
  hand: 1 | -1 = 1;
  /** True while sprinting with the ball live in hand - drives the lowered dribble stance (see Player.updateWalkCycle). */
  dribbleSprintActive = false;
  lastShotResult: ShotResult | null = null;

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly input: InputManager,
    physicsGravity: number,
    physicsDt: number,
  ) {
    this.dribble = new DribbleSystem(player, ball, physicsGravity);
    this.moves = new DribbleMoveSystem(this.movement);
    this.shooting = new ShootingSystem(player, ball, physicsGravity, physicsDt);
    this.passing = new PassingSystem(player, ball, physicsGravity, physicsDt);
  }

  /**
   * Call once per fixed physics step. Movement is world-relative (the
   * broadcast camera never rotates - see CameraController and
   * PlayerMovement.step for the exact screen-to-world mapping).
   */
  fixedUpdate(dt: number, hoops: readonly Hoop[]): void {
    const sprint = this.input.isDown('sprint');
    // Real gather rule: once the shot motion starts, you don't get to keep
    // cutting new directions with the stick - whatever momentum you already
    // had just carries you a step or two and decelerates to a stop (via
    // PlayerMovement's normal no-input deceleration curve), same as the
    // one or two steps a real gather allows before you have to release.
    // Feeding it live input here was letting the player sprint freely for
    // the whole hold, which read as a canned "gather" that never actually
    // stopped moving - as if the two systems were fighting each other.
    const moveAxis = this.shooting.state === 'charging' ? { x: 0, y: 0 } : this.input.moveAxis;
    const displacement = this.movement.step(moveAxis, sprint, dt);
    this.player.applyMovement(displacement, dt);

    if (this.movement.speed > 0.05) {
      this.player.setFacing(this.movement.facingYaw);
    }

    this.handlePossession(dt, hoops, sprint);
    this.stateMachine.update(dt);
  }

  private handlePossession(dt: number, hoops: readonly Hoop[], sprint: boolean): void {
    if (this.hasBall && this.shooting.state === 'idle' && this.input.wasPressedThisFrame('shoot')) {
      this.shooting.startCharge();
    }

    if (this.shooting.state === 'charging') {
      this.dribbleSprintActive = false;
      this.shooting.fixedUpdate(dt, this.hand);
      if (this.input.wasReleasedThisFrame('shoot')) {
        const result = this.shooting.release(hoops);
        if (result) {
          this.lastShotResult = result;
          this.hasBall = false;
          this.dribbleSprintActive = false;
          this.stateMachine.enter('release');
          this.ballOwnership.claim('shot', 'shooting');
          return;
        }
      }
      this.stateMachine.enter('gather');
      this.ballOwnership.claim('gather', 'shooting');
      return;
    }

    if (this.hasBall && this.input.wasPressedThisFrame('pass')) {
      this.passing.throwChestPass();
      this.hasBall = false;
      this.dribbleSprintActive = false;
      this.stateMachine.enter('pass');
      this.ballOwnership.claim('pass', 'passing');
      return;
    }

    if (!this.hasBall) {
      this.dribbleSprintActive = false;
      const secured = this.looseBallRecovery.update(dt, this.player, this.ball, this.dribble, this.hand);
      if (secured) {
        this.hasBall = true;
        this.stateMachine.enter('tripleThreat');
        this.ballOwnership.claim(this.hand === 1 ? 'controlledRight' : 'controlledLeft', 'dribble');
      } else if (this.looseBallRecovery.isRecovering) {
        this.stateMachine.enter('recovering');
        this.ballOwnership.claim('recovery', 'dribble');
      } else {
        this.stateMachine.enter(this.computeLocomotionState(sprint));
        this.ballOwnership.claim('free', 'none');
      }
      return;
    }

    this.handleDribbleMoves(dt);
    this.dribbleSprintActive = sprint && this.movement.speed > 0.3;
    const isStationary = this.movement.speed < 0.3;
    // Gameplay-systems spec section 5 ("low dribble / high dribble"): the
    // pocket height itself responds to movement state, not just the
    // visual crouch - tight and low while sprinting (ball security over
    // control), higher and more relaxed set in triple threat, normal in
    // between.
    const dribbleHeight = this.dribbleSprintActive
      ? DRIBBLE_HEIGHT_LOW
      : isStationary
        ? DRIBBLE_HEIGHT_HIGH
        : DRIBBLE_HEIGHT_NORMAL;
    this.dribble.fixedUpdate(dt, this.hand, dribbleHeight, this.movement.velocity);

    const activeMove = this.moves.activeType;
    if (activeMove !== null) {
      this.stateMachine.enter(activeMove);
    } else if (isStationary) {
      this.stateMachine.enter('tripleThreat');
    } else {
      this.stateMachine.enter('dribbling');
    }
    this.ballOwnership.claim(this.hand === 1 ? 'controlledRight' : 'controlledLeft', 'dribble');
  }

  /**
   * Only 'idle'/'walk'/'sprint' are reachable today - PlayerMovement has
   * just two speed tiers (walkSpeed/sprintSpeed), no distinct third "run"
   * speed to key a 'run' state off of, so that state stays defined but
   * unused rather than backed by a made-up threshold.
   */
  private computeLocomotionState(sprint: boolean): PlayerState {
    if (this.movement.speed < 0.05) return 'idle';
    return sprint ? 'sprint' : 'walk';
  }

  private handleDribbleMoves(dt: number): void {
    const midMoveSwitch = this.moves.fixedUpdate(dt, this.hand);
    if (midMoveSwitch !== null) this.hand = midMoveSwitch;
    if (this.moves.isActive) return;

    for (const action of MOVE_ACTIONS) {
      if (this.input.wasPressedThisFrame(action)) {
        const newHand = this.moves.trigger(action, this.player, this.hand);
        if (newHand !== null) this.hand = newHand;
        break;
      }
    }
  }

  /** Called by Game once a loose ball has settled, to hand it back to this player. */
  regainPossession(): void {
    this.hasBall = true;
  }

  /**
   * External possession-loss trigger - currently only DefenderAI's steal
   * check. Mirrors the exact same state this player ends up in when it
   * naturally loses the ball on its own (shot release, pass, a rules
   * violation): the next handlePossession tick picks up from here
   * completely normally, running its usual loose-ball-recovery/locomotion
   * branch, so a stolen ball isn't a special case anywhere downstream.
   */
  forceLoseBall(): void {
    this.hasBall = false;
    this.dribbleSprintActive = false;
    this.ballOwnership.claim('free', 'none');
  }

  /** Snaps the ball into the dribble hand immediately (used for the initial spawn only). */
  placeBallInHand(): void {
    const anchor = new THREE.Vector3();
    this.dribble.getHandAnchor(this.hand, anchor);
    this.ball.body.setTranslation(anchor, true);
    this.ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
}
