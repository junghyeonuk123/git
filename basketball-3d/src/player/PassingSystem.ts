import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';
import { solveLaunch } from '@/utils/Ballistics';

const PASS_DISTANCE = 6; // meters downrange the "receiver" point sits
const PASS_HEIGHT = 1.4; // chest height
const PASS_ANGLE = THREE.MathUtils.degToRad(18); // flat, direct chest-pass arc

/**
 * A real physics-launched pass (spec section 16): no receiver/teammate
 * AI exists yet (that's Phase 5), so there is nothing to catch it, but
 * the throw itself is not a shortcut - it launches with a real velocity
 * from Ballistics and is handed fully to the ball's rigid body, so it
 * legitimately bounces off the floor/rim/backboard exactly like a shot
 * would. Bounce/lob/alley-oop variants are meaningful once a receiver
 * exists to aim them at.
 */
export class PassingSystem {
  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly physicsGravity: number,
    private readonly physicsDt: number,
  ) {}

  throwChestPass(): THREE.Vector3 | null {
    const from = this.ball.position;
    const dir = this.player.facingDirection;
    const target = new THREE.Vector3(
      from.x + dir.x * PASS_DISTANCE,
      this.player.groundY + PASS_HEIGHT,
      from.z + dir.z * PASS_DISTANCE,
    );

    const solution = solveLaunch(from, target, PASS_ANGLE, this.physicsGravity, this.physicsDt);
    const velocity = solution ? solution.velocity : dir.clone().multiplyScalar(7).setY(1.5);

    this.ball.release(velocity, new THREE.Vector3(0, 0, 0));
    return velocity;
  }
}
