/**
 * Fixed-timestep accumulator so physics results are identical regardless
 * of render frame rate (144Hz vs 30Hz produce the same simulation).
 */
export class Time {
  readonly fixedDeltaSeconds: number;
  private accumulator = 0;
  private lastNow = 0;
  private started = false;

  /** Seconds since the previous rendered frame (unclamped, for animation/camera). */
  deltaSeconds = 0;
  elapsedSeconds = 0;
  frameCount = 0;

  constructor(fixedHz = 60) {
    this.fixedDeltaSeconds = 1 / fixedHz;
  }

  /** Call once per rAF frame. Returns how many fixed physics steps should run. */
  tick(nowMs: number): number {
    if (!this.started) {
      this.started = true;
      this.lastNow = nowMs;
    }
    let delta = (nowMs - this.lastNow) / 1000;
    this.lastNow = nowMs;
    // Clamp to avoid a "spiral of death" after a tab is backgrounded.
    delta = Math.min(delta, 0.25);

    this.deltaSeconds = delta;
    this.elapsedSeconds += delta;
    this.frameCount += 1;

    this.accumulator += delta;
    let steps = 0;
    const maxStepsPerFrame = 8;
    while (this.accumulator >= this.fixedDeltaSeconds && steps < maxStepsPerFrame) {
      this.accumulator -= this.fixedDeltaSeconds;
      steps += 1;
    }
    return steps;
  }

  /** 0..1 fraction between the last and next physics step, for render interpolation. */
  get interpolationAlpha(): number {
    return this.accumulator / this.fixedDeltaSeconds;
  }
}
