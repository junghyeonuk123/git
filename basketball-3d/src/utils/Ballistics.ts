import * as THREE from 'three';
import { BALL_LINEAR_DAMPING } from '@/physics/MaterialProperties';

/**
 * Projectile targeting used by shooting/passing: given a release point,
 * a target point, and a launch angle, solves the speed needed so the
 * *actual stepped physics simulation* (not the textbook continuous
 * parabola) passes through the target. See spec section 39 - the closed
 * form p(t) = p0 + v0*t + 1/2*g*t^2 is the starting guess; the refinement
 * loop below exists because a discretely-stepped simulation drifts
 * slightly from that continuous solution, and the rim opening is narrow
 * enough (spec section 6) for that drift to matter.
 *
 * It also has to match the ball's actual rigid-body linear damping
 * (BALL_LINEAR_DAMPING) - a shot solved against pure gravity alone
 * lands consistently short, because the real ball bleeds a little
 * velocity every step the same way Rapier's own integrator does.
 */

const MAX_SIM_STEPS = 240;

/** Same per-step velocity decay Rapier applies for a body's linear_damping. */
function applyDamping(vHoriz: number, vY: number, dt: number): [number, number] {
  const factor = 1 / (1 + dt * BALL_LINEAR_DAMPING);
  return [vHoriz * factor, vY * factor];
}

function closedFormSpeed(dx: number, dy: number, angle: number, gravity: number): number | null {
  const cos = Math.cos(angle);
  const tan = Math.tan(angle);
  const denom = 2 * cos * cos * (dx * tan - dy);
  if (denom <= 0) return null;
  const v2 = (gravity * dx * dx) / denom;
  return v2 > 0 ? Math.sqrt(v2) : null;
}

/** Simulates an unobstructed parabola (same semi-implicit-Euler stepping Rapier uses) and returns horizontal distance traveled when it crosses targetY. */
function simulateHorizontalDistanceAtHeight(speed: number, angle: number, targetY: number, startY: number, gravity: number, dt: number): number {
  let horiz = 0;
  let y = startY;
  let vHoriz = speed * Math.cos(angle);
  let vY = speed * Math.sin(angle);
  let prevY = y;
  for (let i = 0; i < MAX_SIM_STEPS; i++) {
    prevY = y;
    vY -= gravity * dt;
    [vHoriz, vY] = applyDamping(vHoriz, vY, dt);
    horiz += vHoriz * dt;
    y += vY * dt;
    if (prevY > targetY && y <= targetY) {
      const t = (prevY - targetY) / (prevY - y);
      return horiz - vHoriz * dt * (1 - t);
    }
  }
  return horiz;
}

export interface BallisticSolution {
  velocity: THREE.Vector3;
  speed: number;
  angle: number;
}

/**
 * Solves a launch velocity from `start` to `target` at the given
 * elevation `angle` (radians above horizontal), refined against the
 * fixed physics timestep `dt` so it lands precisely even though the
 * simulation is discretely stepped. Returns null if the target is
 * unreachable at that angle (too high for the available horizontal
 * distance).
 */
export function solveLaunch(
  start: THREE.Vector3,
  target: THREE.Vector3,
  angle: number,
  gravity: number,
  dt: number,
): BallisticSolution | null {
  const dx = Math.hypot(target.x - start.x, target.z - start.z);
  const dy = target.y - start.y;
  if (dx < 1e-4) return null;

  const guess = closedFormSpeed(dx, dy, angle, gravity);
  if (!guess) return null;

  const f = (speed: number) => simulateHorizontalDistanceAtHeight(speed, angle, target.y, start.y, gravity, dt) - dx;

  let s0 = guess * 0.9;
  let s1 = guess * 1.1;
  let f0 = f(s0);
  let f1 = f(s1);
  for (let i = 0; i < 10 && Math.abs(f1) > 0.01; i++) {
    if (Math.abs(f1 - f0) < 1e-6) break;
    const s2 = s1 - (f1 * (s1 - s0)) / (f1 - f0);
    s0 = s1;
    f0 = f1;
    s1 = s2;
    f1 = f(s2);
  }
  if (!Number.isFinite(s1) || s1 <= 0) return null;

  const dirX = (target.x - start.x) / dx;
  const dirZ = (target.z - start.z) / dx;
  const vHoriz = s1 * Math.cos(angle);
  const vY = s1 * Math.sin(angle);

  return {
    velocity: new THREE.Vector3(dirX * vHoriz, vY, dirZ * vHoriz),
    speed: s1,
    angle,
  };
}

/**
 * Picks a shallower arc for long shots, a steeper one up close - a
 * heuristic, not a rule. Previously ranged up to 62 degrees for close
 * shots, which reads as the ball "jumping" straight up into an
 * exaggerated moon-ball arc rather than a real jump shot's release -
 * a real shot's arc very rarely needs to exceed about 50-52 degrees
 * even up close, since the release point is already well above the rim
 * plane.
 */
export function shotAngleForDistance(horizontalDistance: number): number {
  const deg = 50 - horizontalDistance * 1.2;
  return THREE.MathUtils.degToRad(THREE.MathUtils.clamp(deg, 42, 50));
}
