import * as THREE from 'three';
import type { PlayerMovement } from './PlayerMovement';
import type { Player } from './Player';

export type DribbleMoveType = 'crossover' | 'hesitation' | 'stepback' | 'inAndOut' | 'legsThrough';

const UP = new THREE.Vector3(0, 1, 0);

const CROSSOVER_DURATION = 0.3;
const CROSSOVER_BURST = 2.6; // m/s, lateral juke toward the new dribbling hand

const HESITATION_DURATION = 0.42;
const HESITATION_FREEZE_END = 0.16; // seconds of near-stop stutter before the explosion
const HESITATION_FREEZE_SCALE = 0.2;
const HESITATION_BURST_SCALE = 1.35;

const STEPBACK_DURATION = 0.35;
const STEPBACK_BURST = 4.0; // m/s, straight back from facing direction

const IN_AND_OUT_DURATION = 0.3;
const IN_AND_OUT_SNAP_BACK = 0.14; // fake crossover snaps back to the original hand at this point
const IN_AND_OUT_BURST = 1.4; // small forward burst - the move sells a change of direction that never happens

const LEGS_THROUGH_DURATION = 0.32;
const LEGS_THROUGH_SLOW_SCALE = 0.85; // control move, not a juke - costs a little speed instead of gaining any

const DURATIONS: Record<DribbleMoveType, number> = {
  crossover: CROSSOVER_DURATION,
  hesitation: HESITATION_DURATION,
  stepback: STEPBACK_DURATION,
  inAndOut: IN_AND_OUT_DURATION,
  legsThrough: LEGS_THROUGH_DURATION,
};

/**
 * The five dribble moves from the original 2D game's move set, reimplemented
 * as short self-expiring state machines that nudge PlayerMovement's velocity
 * and/or hand over a few hundred milliseconds. None of them touch the ball
 * directly - DribbleSystem reads whatever hand a move leaves active and
 * bounces the ball there, so a move is just player-side juking.
 */
export class DribbleMoveSystem {
  private active: DribbleMoveType | null = null;
  private timer = 0;
  private snappedBack = false;

  constructor(private readonly movement: PlayerMovement) {}

  get isActive(): boolean {
    return this.active !== null;
  }

  /** @returns the hand this move switches the dribble to, or null if it doesn't. */
  trigger(type: DribbleMoveType, player: Player, hand: 1 | -1): 1 | -1 | null {
    if (this.active) return null;
    this.active = type;
    this.timer = 0;
    this.snappedBack = false;

    switch (type) {
      case 'crossover': {
        const newHand: 1 | -1 = hand === 1 ? -1 : 1;
        this.movement.applyImpulse(worldLateral(player.facingYaw, newHand, CROSSOVER_BURST));
        return newHand;
      }
      case 'stepback': {
        const back = player.facingDirection.multiplyScalar(-STEPBACK_BURST);
        this.movement.applyImpulse(new THREE.Vector2(back.x, back.z));
        return null;
      }
      case 'inAndOut': {
        const newHand: 1 | -1 = hand === 1 ? -1 : 1;
        const fwd = player.facingDirection.multiplyScalar(IN_AND_OUT_BURST);
        this.movement.applyImpulse(new THREE.Vector2(fwd.x, fwd.z));
        return newHand;
      }
      case 'legsThrough':
        return hand === 1 ? -1 : 1;
      case 'hesitation':
        return null;
    }
  }

  /** Call once per fixed step while the player has the ball. @returns a hand switch to apply, or null. */
  fixedUpdate(dt: number, hand: 1 | -1): 1 | -1 | null {
    if (!this.active) {
      this.movement.speedScale = 1;
      return null;
    }

    this.timer += dt;
    let handSwitch: 1 | -1 | null = null;

    if (this.active === 'hesitation') {
      this.movement.speedScale = this.timer < HESITATION_FREEZE_END ? HESITATION_FREEZE_SCALE : HESITATION_BURST_SCALE;
    } else if (this.active === 'legsThrough') {
      this.movement.speedScale = LEGS_THROUGH_SLOW_SCALE;
    } else {
      this.movement.speedScale = 1;
    }

    if (this.active === 'inAndOut' && !this.snappedBack && this.timer >= IN_AND_OUT_SNAP_BACK) {
      this.snappedBack = true;
      handSwitch = hand === 1 ? -1 : 1;
    }

    if (this.timer >= DURATIONS[this.active]) {
      this.active = null;
      this.movement.speedScale = 1;
    }

    return handSwitch;
  }
}

function worldLateral(yaw: number, sign: 1 | -1, speed: number): THREE.Vector2 {
  const dir = new THREE.Vector3(sign, 0, 0).applyAxisAngle(UP, yaw).multiplyScalar(speed);
  return new THREE.Vector2(dir.x, dir.z);
}
