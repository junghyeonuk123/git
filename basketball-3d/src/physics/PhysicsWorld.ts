import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Thin wrapper around the Rapier world. Owns WASM init (must happen before
 * any other physics module runs) and the fixed-timestep step call.
 * Gameplay code should reach the Rapier types through `world.RAPIER`
 * rather than importing the package directly, so there is exactly one
 * init path.
 */
export class PhysicsWorld {
  private static initialized = false;

  readonly world: RAPIER.World;
  readonly RAPIER: typeof RAPIER;

  private constructor(rapier: typeof RAPIER, gravity: RAPIER.Vector3) {
    this.RAPIER = rapier;
    this.world = new rapier.World(gravity);
    this.world.timestep = 1 / 60;
  }

  static async create(gravityY = -9.81): Promise<PhysicsWorld> {
    if (!PhysicsWorld.initialized) {
      await RAPIER.init();
      PhysicsWorld.initialized = true;
    }
    return new PhysicsWorld(RAPIER, { x: 0, y: gravityY, z: 0 });
  }

  step(): void {
    this.world.step();
  }
}
