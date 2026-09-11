/**
 * Per-surface physical properties. Centralized so tuning "does the ball feel
 * right off the rim" never means hunting through collider setup code.
 */
export interface PhysicsMaterial {
  restitution: number;
  friction: number;
}

export const PhysicsMaterials = {
  ball: { restitution: 0.78, friction: 0.6 } satisfies PhysicsMaterial,
  court: { restitution: 0.42, friction: 0.9 } satisfies PhysicsMaterial,
  backboard: { restitution: 0.55, friction: 0.3 } satisfies PhysicsMaterial,
  rim: { restitution: 0.5, friction: 0.35 } satisfies PhysicsMaterial,
  player: { restitution: 0.05, friction: 0.4 } satisfies PhysicsMaterial,
  /** The basket's support pole - a padded metal stanchion, duller than the backboard glass. */
  structure: { restitution: 0.3, friction: 0.6 } satisfies PhysicsMaterial,
} as const;

/**
 * Ball's rigid-body linear damping. Pulled out as its own constant
 * (rather than a literal on the RigidBodyDesc in Ball.ts) because
 * Ballistics.ts's flight simulation needs the exact same value to
 * predict where a shot actually lands - the ball decelerates slightly
 * throughout its arc, and any targeting solve that ignores that drifts
 * short of the target.
 */
export const BALL_LINEAR_DAMPING = 0.05;

export const NetMaterial = {
  /** Verlet/PBD point damping (0..1 per step, higher = settles faster). */
  damping: 0.985,
  /** Distance-constraint stiffness solved per relaxation iteration. */
  stiffness: 0.9,
  solverIterations: 3,
} as const;
