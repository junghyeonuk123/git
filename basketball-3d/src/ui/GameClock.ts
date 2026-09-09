import type { BasketballRules } from '@/basketball/BasketballRules';

/** Rule 3-Section II-8: "The game clock shall be equipped to show tenths-of-a-second during the last minute of each period." */
const TENTHS_THRESHOLD = 60;

function formatClock(seconds: number): string {
  const clamped = Math.max(0, seconds);
  if (clamped < TENTHS_THRESHOLD) {
    const m = Math.floor(clamped / 60);
    const s = clamped % 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  }
  const m = Math.floor(clamped / 60);
  const s = Math.floor(clamped % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Renders the quarter/game-clock/shot-clock trio. Pure DOM text updates - no game logic lives here. */
export class GameClock {
  private readonly quarterEl = document.getElementById('quarter-value') as HTMLDivElement;
  private readonly clockEl = document.getElementById('game-clock-value') as HTMLDivElement;
  private readonly shotClockEl = document.getElementById('shot-clock-value') as HTMLDivElement;

  update(rules: BasketballRules): void {
    this.quarterEl.textContent = `Q${rules.quarter}`;
    this.clockEl.textContent = formatClock(rules.quarterClock);

    const shotClock = Math.ceil(rules.shotClock);
    this.shotClockEl.textContent = String(shotClock);
    this.shotClockEl.classList.toggle('urgent', shotClock <= 5);
  }
}
