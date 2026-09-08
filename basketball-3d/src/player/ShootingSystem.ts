import * as THREE from 'three';
import type { Player } from './Player';
import type { Ball } from '@/basketball/Ball';
import type { Hoop } from '@/basketball/Hoop';
import { solveLaunch, shotAngleForDistance } from '@/utils/Ballistics';

const GATHER_HEIGHT = 1.3; // chest/set-point height for the ball while charging
const FILL_RATE = 1.0; // meter units per second
const METER_CAP = 1.15;
const ZONE_WEAK_MAX = 0.62; // also doubles as the swish window's lower bound
const ZONE_SWISH_MAX = 0.7;
const ZONE_BANK_MAX = 0.8;
const BACKSPIN = 26; // rad/s, purely visual - see Ball seam rendering

export type ShotZone = 'weak' | 'swish' | 'bank' | 'strong';

export interface ShotResult {
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  zone: ShotZone;
  targetHoop: Hoop;
}

function classifyMeter(meter: number): ShotZone {
  if (meter <= ZONE_WEAK_MAX) return 'weak';
  if (meter <= ZONE_SWISH_MAX) return 'swish';
  if (meter <= ZONE_BANK_MAX) return 'bank';
  return 'strong';
}

/**
 * Turns a hold-and-release meter into a real launch velocity via
 * projectile targeting (Ballistics.solveLaunch), then hands the ball
 * fully to physics - see spec section 12/45: the outcome is never
 * scripted, it's whatever the rim/backboard/net collisions actually do
 * with that velocity. The meter only decides which point the shot
 * *aims* at and how much power lands outside that: the swish window
 * targets the rim center, a slightly-too-strong release targets the
 * backboard (a bank shot), and everything else is a generic
 * over/under-powered attempt that may still rattle in or clank out.
 */
export class ShootingSystem {
  state: 'idle' | 'charging' = 'idle';
  meter = 0;

  constructor(
    private readonly player: Player,
    private readonly ball: Ball,
    private readonly physicsGravity: number,
    private readonly physicsDt: number,
  ) {}

  startCharge(): void {
    if (this.state !== 'idle') return;
    this.state = 'charging';
    this.meter = 0;
  }

  /** Call once per fixed physics step while charging - holds the ball in a gather pose. */
  fixedUpdate(dt: number, hand: 1 | -1): void {
    if (this.state !== 'charging') return;
    this.meter = Math.min(METER_CAP, this.meter + FILL_RATE * dt);

    const gatherPos = new THREE.Vector3();
    this.player.getHandPosition(gatherPos, hand, GATHER_HEIGHT);
    this.ball.setKinematicHeld(gatherPos);
  }

  /** Releases the shot at the nearest hoop. Returns null if not currently charging. */
  release(hoops: readonly Hoop[]): ShotResult | null {
    if (this.state !== 'charging') return null;
    this.state = 'idle';
    const meter = this.meter;

    const releasePos = this.ball.position;
    const targetHoop = nearestHoop(hoops, releasePos);
    const zone = classifyMeter(meter);

    const dxRim = Math.hypot(targetHoop.rimCenter.x - releasePos.x, targetHoop.rimCenter.z - releasePos.z);
    const rimAngle = shotAngleForDistance(dxRim);

    let solution =
      zone === 'bank'
        ? solveLaunch(releasePos, targetHoop.bankSpot, shotAngleForDistance(dxRim * 0.9), this.physicsGravity, this.physicsDt)
        : solveLaunch(releasePos, targetHoop.rimCenter, rimAngle, this.physicsGravity, this.physicsDt);

    if (!solution) {
      solution = { velocity: new THREE.Vector3(0, 6, 0), speed: 6, angle: rimAngle };
    }

    let velocity = solution.velocity;
    if (zone === 'weak' || zone === 'strong') {
      const factor =
        zone === 'weak'
          ? THREE.MathUtils.lerp(0.6, 0.9, meter / ZONE_WEAK_MAX)
          : THREE.MathUtils.lerp(1.08, 1.3, Math.min(1, (meter - ZONE_BANK_MAX) / (METER_CAP - ZONE_BANK_MAX)));
      velocity = velocity.clone().multiplyScalar(factor);
    }

    const horizAxis = new THREE.Vector3(-velocity.z, 0, velocity.x).normalize();
    const angularVelocity = horizAxis.multiplyScalar(BACKSPIN);

    this.ball.release(velocity, angularVelocity);
    return { velocity, angularVelocity, zone, targetHoop };
  }
}

function nearestHoop(hoops: readonly Hoop[], from: THREE.Vector3): Hoop {
  let best = hoops[0]!;
  let bestDist = Infinity;
  for (const hoop of hoops) {
    const d = from.distanceToSquared(hoop.rimCenter);
    if (d < bestDist) {
      bestDist = d;
      best = hoop;
    }
  }
  return best;
}
