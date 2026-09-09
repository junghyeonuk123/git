import type { ShootingSystem } from '@/player/ShootingSystem';
import { METER_CAP, classifyMeter } from '@/player/ShootingSystem';
import { clamp } from '@/utils/MathUtils';

const ZONE_LABELS: Record<string, string> = {
  weak: 'TOO SOFT',
  swish: 'SWISH',
  bank: 'BANK',
  strong: 'TOO STRONG',
};

/**
 * The visible hold-and-release gauge (spec section 13): without this on
 * screen a player has no way to time a release into the swish/bank
 * windows ShootingSystem.ts actually uses - they'd just be guessing.
 * Zone widths are drawn from the same exported constants the release
 * logic classifies against, so the bar never drifts out of sync with
 * what a release at that height actually does.
 */
export class ShotMeter {
  private readonly container = document.getElementById('shot-meter') as HTMLDivElement;
  private readonly pointer = document.getElementById('shot-meter-pointer') as HTMLDivElement;
  private readonly label = document.getElementById('shot-meter-label') as HTMLDivElement;

  update(shooting: ShootingSystem): void {
    const charging = shooting.state === 'charging';
    this.container.hidden = !charging;
    if (!charging) return;

    const frac = clamp(shooting.meter / METER_CAP, 0, 1);
    this.pointer.style.bottom = `${frac * 100}%`;
    this.label.textContent = ZONE_LABELS[classifyMeter(shooting.meter)] ?? '';
  }
}
