import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_HALF_X, ARENA_HALF_Z, FLOOR_HALF_X, FLOOR_HALF_Z, ROW_COUNT, ROW_DEPTH, ROW_HEIGHT, WALKWAY } from './Arena';

const SEAT_SPACING = 0.55;
const FILL_RATE = 0.72; // real crowds are never 100% packed
const SWAY_AMPLITUDE_IDLE = 0.05; // radians
const SWAY_AMPLITUDE_CHEER = 0.24;
const SWAY_SPEED_IDLE = 0.6; // rad/s
const SWAY_SPEED_CHEER = 2.4;
const CHEER_DURATION = 2.2; // seconds

interface SeatSlot {
  x: number;
  y: number;
  z: number;
  facingY: number;
  phase: number; // per-instance random offset - the whole point being no two spectators move in lockstep
  scale: number;
}

function buildSpectatorGeometry(): THREE.BufferGeometry {
  const torso = new THREE.BoxGeometry(0.34, 0.5, 0.28);
  torso.translate(0, 0.25, 0);
  const head = new THREE.SphereGeometry(0.13, 8, 6);
  head.translate(0, 0.62, 0);
  const merged = mergeGeometries([torso, head]);
  torso.dispose();
  head.dispose();
  return merged;
}

/**
 * Populates the Arena's empty bleacher rows with low-poly spectators
 * (spec section 18): one InstancedMesh for the whole crowd (a single
 * draw call regardless of count - roughly a thousand seats here), with
 * per-instance color variety and a subtle idle sway driven by a random
 * per-instance phase offset, so the crowd never reads as one synchronized
 * mass. `triggerCheer()` briefly raises the sway amplitude/speed across
 * the whole crowd - a cheap stand-in for a real CHEER animation state,
 * meant to be called on a made basket.
 */
export class Crowd {
  private readonly mesh: THREE.InstancedMesh;
  private readonly slots: SeatSlot[] = [];
  private readonly dummy = new THREE.Object3D();
  private cheerTimer = 0;

  constructor(scene: THREE.Scene) {
    this.collectSlots('far');
    this.collectSlots('baselinePos');
    this.collectSlots('baselineNeg');

    const geometry = buildSpectatorGeometry();
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    this.mesh = new THREE.InstancedMesh(geometry, material, this.slots.length);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const palette = [0x8a3b3b, 0x3b5a8a, 0x3b8a5e, 0x8a7a3b, 0x6a3b8a, 0x3b8a86, 0x8a3b6f, 0x555b66];
    const color = new THREE.Color();
    for (let i = 0; i < this.slots.length; i++) {
      color.setHex(palette[Math.floor(Math.random() * palette.length)]!);
      this.mesh.setColorAt(i, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    scene.add(this.mesh);
    this.update(0, 0);
  }

  /** A brief cheer ripple across the whole crowd - call on a made basket or similar highlight. */
  triggerCheer(): void {
    this.cheerTimer = CHEER_DURATION;
  }

  /** Call once per rendered frame - purely cosmetic, never touches physics. */
  update(dt: number, elapsed: number): void {
    this.cheerTimer = Math.max(0, this.cheerTimer - dt);
    const cheering = this.cheerTimer > 0;
    const amp = cheering ? SWAY_AMPLITUDE_CHEER : SWAY_AMPLITUDE_IDLE;
    const speed = cheering ? SWAY_SPEED_CHEER : SWAY_SPEED_IDLE;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const sway = Math.sin(elapsed * speed + slot.phase) * amp;
      this.dummy.position.set(slot.x, slot.y + Math.abs(sway) * 0.4, slot.z);
      this.dummy.rotation.set(0, slot.facingY + sway, 0);
      this.dummy.scale.setScalar(slot.scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Mirrors Arena's own row layout so spectators land exactly on its risers. */
  private collectSlots(which: 'far' | 'baselinePos' | 'baselineNeg'): void {
    const along = which === 'far' ? ARENA_HALF_X * 2 : ARENA_HALF_Z * 2;
    const innerEdge = which === 'far' ? FLOOR_HALF_Z + WALKWAY : FLOOR_HALF_X + WALKWAY;
    const sign = which === 'baselineNeg' ? -1 : 1;
    const seatsPerRow = Math.floor(along / SEAT_SPACING);

    for (let r = 0; r < ROW_COUNT; r++) {
      const rowTopY = ROW_HEIGHT * (r + 1);
      const rowCenterOffset = innerEdge + r * ROW_DEPTH + ROW_DEPTH / 2;
      for (let s = 0; s < seatsPerRow; s++) {
        if (Math.random() > FILL_RATE) continue;
        const alongPos = (s + 0.5) * SEAT_SPACING - along / 2;

        let x: number;
        let z: number;
        let facingY: number;
        if (which === 'far') {
          x = alongPos;
          z = rowCenterOffset;
          facingY = Math.PI; // faces -Z, toward the court
        } else {
          x = sign * rowCenterOffset;
          z = alongPos;
          facingY = sign > 0 ? -Math.PI / 2 : Math.PI / 2; // faces toward center court
        }

        this.slots.push({
          x,
          y: rowTopY,
          z,
          facingY,
          phase: Math.random() * Math.PI * 2,
          scale: 0.85 + Math.random() * 0.3,
        });
      }
    }
  }
}
