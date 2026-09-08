import type { InputManager } from '@/core/InputManager';
import type { Player } from './Player';
import { PlayerMovement } from './PlayerMovement';

/**
 * Translates raw input + camera orientation into calls on Player/Movement.
 * Kept separate from Player (which owns the physics body) and
 * PlayerMovement (pure velocity math) so gameplay systems added later
 * (ShootingSystem, DribbleSystem) can intercept/override movement here
 * without touching either of those.
 */
export class PlayerController {
  readonly movement = new PlayerMovement();

  constructor(
    private readonly player: Player,
    private readonly input: InputManager,
  ) {}

  /** Call once per fixed physics step. */
  fixedUpdate(cameraYaw: number, dt: number): void {
    const sprint = this.input.isDown('sprint');
    const displacement = this.movement.step(this.input.moveAxis, cameraYaw, sprint, dt);
    this.player.applyMovement(displacement, dt);

    if (this.movement.speed > 0.05) {
      this.player.setFacing(this.movement.facingYaw);
    }
  }
}
