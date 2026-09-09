import * as THREE from 'three';
import type { InputManager } from '@/core/InputManager';
import type { Ball } from '@/basketball/Ball';
import type { Hoop } from '@/basketball/Hoop';
import type { Player } from './Player';
import { PlayerMovement } from './PlayerMovement';
import { DribbleSystem } from './DribbleSystem';
import { DribbleMoveSystem, type DribbleMoveType } from './DribbleMoves';
import { ShootingSystem, type ShotResult } from './ShootingSystem';
import { PassingSystem } from './PassingSystem';

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
    const displacement = this.movement.step(this.input.moveAxis, sprint, dt);
    this.player.applyMovement(displacement, dt);

    if (this.movement.speed > 0.05) {
      this.player.setFacing(this.movement.facingYaw);
    }

    this.handlePossession(dt, hoops, sprint);
  }

  private handlePossession(dt: number, hoops: readonly Hoop[], sprint: boolean): void {
    if (this.hasBall && this.shooting.state === 'idle' && this.input.wasPressedThisFrame('shoot')) {
      this.shooting.startCharge();
    }

    if (this.shooting.state === 'charging') {
      this.shooting.fixedUpdate(dt, this.hand);
      if (this.input.wasReleasedThisFrame('shoot')) {
        const result = this.shooting.release(hoops);
        if (result) {
          this.lastShotResult = result;
          this.hasBall = false;
          this.dribbleSprintActive = false;
        }
      }
      return;
    }

    if (this.hasBall && this.input.wasPressedThisFrame('pass')) {
      this.passing.throwChestPass();
      this.hasBall = false;
      this.dribbleSprintActive = false;
      return;
    }

    if (!this.hasBall) {
      this.dribbleSprintActive = false;
      return;
    }

    this.handleDribbleMoves(dt);
    this.dribbleSprintActive = sprint && this.movement.speed > 0.3;
    this.dribble.fixedUpdate(dt, this.hand);
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

  /** Snaps the ball into the dribble hand immediately (used for the initial spawn only). */
  placeBallInHand(): void {
    const anchor = new THREE.Vector3();
    this.dribble.getHandAnchor(this.hand, anchor);
    this.ball.body.setTranslation(anchor, true);
    this.ball.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }
}
