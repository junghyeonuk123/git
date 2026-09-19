import type { BasketballRules, GameEvent } from '@/basketball/BasketballRules';

const BANNER_VISIBLE_SECONDS = 2.2;

/** Renders the score and a brief fading banner for score/violation events. */
export class Scoreboard {
  private readonly scoreEl = document.getElementById('score-value') as HTMLDivElement;
  private readonly bannerEl = document.getElementById('event-banner') as HTMLDivElement;

  private lastShownEvent: GameEvent | null = null;
  private bannerTimer = 0;

  update(rules: BasketballRules, dt: number): void {
    this.scoreEl.textContent = String(rules.score);

    if (rules.lastEvent && rules.lastEvent !== this.lastShownEvent) {
      this.lastShownEvent = rules.lastEvent;
      this.showBanner(rules.lastEvent);
    }

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) {
        this.bannerEl.classList.remove('visible');
      }
    }
  }

  private showBanner(event: GameEvent): void {
    this.bannerEl.textContent = event.detail;
    this.bannerEl.classList.toggle('violation', event.kind === 'violation');
    this.bannerEl.classList.add('visible');
    this.bannerTimer = BANNER_VISIBLE_SECONDS;
  }
}
