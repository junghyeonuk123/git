import * as THREE from 'three';
import { CourtDimensions as CD } from './CourtDimensions';

const STRAND_COUNT = 10;
const RING_COUNT = 6;
const STRIDE = RING_COUNT + 1;
const GRAVITY = -9.81;
const DAMPING = 0.98;
const CONSTRAINT_ITERATIONS = 3;
const BALL_INFLUENCE_RADIUS = 0.16;
const BALL_PUSH_STRENGTH = 0.9;

/**
 * A small Verlet/PBD cloth (spec section 7): the net is not a static
 * decoration, it's ~70 simulated points that gravity, distance
 * constraints, and the ball's own motion push around every physics
 * step. Deliberately low-resolution and using only nearest-neighbor
 * distance constraints (no full cloth solver) - a basketball net just
 * needs to sway and settle convincingly, not be an accurate garment
 * simulation, and this keeps the per-step cost trivial (spec section
 * 27: physics detail should scale with gameplay importance, and the
 * net is explicitly "medium" priority next to the ball/rim/backboard).
 *
 * Point indices are always constructed as STRAND_COUNT*STRIDE up front
 * and only ever accessed within that fixed range, so the non-null
 * assertions below are asserting an invariant guaranteed by
 * construction, not skipping a real bounds check.
 */
export class Net {
  readonly group: THREE.Group;

  private readonly positions: THREE.Vector3[] = [];
  private readonly prevPositions: THREE.Vector3[] = [];
  private readonly pinned: boolean[] = [];
  private readonly verticalRest: number[] = []; // per ring index r: rest length between ring r and r+1
  private readonly ringRest: number[] = []; // per ring index r: rest length between adjacent strands at that ring
  private readonly geometry: THREE.BufferGeometry;
  private readonly positionAttr: THREE.BufferAttribute;

  constructor(scene: THREE.Scene, center: THREE.Vector3) {
    this.group = new THREE.Group();
    this.group.position.copy(center);

    const topRadius = CD.hoop.rimRadius;
    const bottomRadius = topRadius * 0.55;
    const height = CD.hoop.netHeight;

    for (let i = 0; i < STRAND_COUNT; i++) {
      const angle = (i / STRAND_COUNT) * Math.PI * 2;
      for (let r = 0; r <= RING_COUNT; r++) {
        const t = r / RING_COUNT;
        const radius = THREE.MathUtils.lerp(topRadius, bottomRadius, t);
        const p = new THREE.Vector3(Math.cos(angle) * radius, -height * t, Math.sin(angle) * radius);
        this.positions.push(p.clone());
        this.prevPositions.push(p.clone());
        this.pinned.push(r === 0);
      }
    }

    for (let r = 0; r < RING_COUNT; r++) {
      this.verticalRest.push(this.point(r).distanceTo(this.point(r + 1)));
    }
    for (let r = 0; r <= RING_COUNT; r++) {
      this.ringRest.push(this.point(r).distanceTo(this.point(STRIDE + r)));
    }

    this.geometry = new THREE.BufferGeometry();
    const buffer = new Float32Array(this.positions.length * 3);
    this.positionAttr = new THREE.BufferAttribute(buffer, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttr);

    const indices: number[] = [];
    for (let i = 0; i < STRAND_COUNT; i++) {
      for (let r = 0; r < RING_COUNT; r++) {
        indices.push(i * STRIDE + r, i * STRIDE + r + 1);
      }
    }
    for (let r = 1; r < RING_COUNT; r++) {
      for (let i = 0; i < STRAND_COUNT; i++) {
        indices.push(i * STRIDE + r, ((i + 1) % STRAND_COUNT) * STRIDE + r);
      }
    }
    this.geometry.setIndex(indices);

    const material = new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(this.geometry, material);
    this.group.add(lines);

    scene.add(this.group);
    this.writeToGeometry();
  }

  private point(i: number): THREE.Vector3 {
    return this.positions[i]!;
  }

  /** Call once per fixed physics step. */
  update(dt: number): void {
    for (let i = 0; i < this.positions.length; i++) {
      if (this.pinned[i]) continue;
      const pos = this.point(i);
      const prev = this.prevPositions[i]!;
      const velocity = pos.clone().sub(prev).multiplyScalar(DAMPING);
      const next = pos.clone().add(velocity).add(new THREE.Vector3(0, GRAVITY * dt * dt, 0));
      prev.copy(pos);
      pos.copy(next);
    }

    for (let iter = 0; iter < CONSTRAINT_ITERATIONS; iter++) {
      for (let i = 0; i < STRAND_COUNT; i++) {
        for (let r = 0; r < RING_COUNT; r++) {
          this.satisfyConstraint(i * STRIDE + r, i * STRIDE + r + 1, this.verticalRest[r]!);
        }
      }
      for (let r = 0; r <= RING_COUNT; r++) {
        for (let i = 0; i < STRAND_COUNT; i++) {
          this.satisfyConstraint(i * STRIDE + r, ((i + 1) % STRAND_COUNT) * STRIDE + r, this.ringRest[r]!);
        }
      }
    }

    this.writeToGeometry();
  }

  /**
   * Nudges nearby net points along the ball's travel direction. `ballLocalPos`
   * and `ballVelocity` must already be in this net's local space (i.e.
   * relative to the rim center this net hangs from).
   */
  applyBallInfluence(ballLocalPos: THREE.Vector3, ballVelocity: THREE.Vector3): void {
    if (ballVelocity.lengthSq() < 0.01) return;
    const dir = ballVelocity.clone().normalize();
    for (let i = 0; i < this.positions.length; i++) {
      if (this.pinned[i]) continue;
      const point = this.point(i);
      const dist = point.distanceTo(ballLocalPos);
      if (dist >= BALL_INFLUENCE_RADIUS) continue;
      const push = dir.clone().multiplyScalar(BALL_PUSH_STRENGTH * (1 - dist / BALL_INFLUENCE_RADIUS) * 0.02);
      point.add(push);
    }
  }

  private satisfyConstraint(aIdx: number, bIdx: number, restLength: number): void {
    const a = this.point(aIdx);
    const b = this.point(bIdx);
    const delta = b.clone().sub(a);
    const dist = delta.length();
    if (dist < 1e-6) return;
    const diff = (dist - restLength) / dist;
    const aPinned = this.pinned[aIdx];
    const bPinned = this.pinned[bIdx];
    if (aPinned && bPinned) return;
    if (aPinned) {
      b.addScaledVector(delta, -diff);
    } else if (bPinned) {
      a.addScaledVector(delta, diff);
    } else {
      a.addScaledVector(delta, diff * 0.5);
      b.addScaledVector(delta, -diff * 0.5);
    }
  }

  private writeToGeometry(): void {
    const arr = this.positionAttr.array as Float32Array;
    for (let i = 0; i < this.positions.length; i++) {
      const p = this.point(i);
      arr[i * 3] = p.x;
      arr[i * 3 + 1] = p.y;
      arr[i * 3 + 2] = p.z;
    }
    this.positionAttr.needsUpdate = true;
  }
}
