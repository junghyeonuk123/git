import { Time } from './Time';

export interface GameLoopCallbacks {
  fixedUpdate: (dt: number) => void;
  update: (dt: number, alpha: number) => void;
  render: () => void;
}

/**
 * Drives the rAF loop, decoupling physics (fixed timestep, called N times
 * per frame as needed) from rendering (once per frame, every frame).
 */
export class GameLoop {
  readonly time = new Time(60);
  private running = false;
  private rafHandle = 0;

  constructor(private readonly callbacks: GameLoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.rafHandle = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
  }

  private tick = (nowMs: number): void => {
    if (!this.running) return;

    const steps = this.time.tick(nowMs);
    for (let i = 0; i < steps; i++) {
      this.callbacks.fixedUpdate(this.time.fixedDeltaSeconds);
    }
    this.callbacks.update(this.time.deltaSeconds, this.time.interpolationAlpha);
    this.callbacks.render();

    this.rafHandle = requestAnimationFrame(this.tick);
  };
}
