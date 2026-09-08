// ============================================================
// Keyboard input: continuous movement state + edge-triggered
// events (shoot press/release, dribble move triggers).
// ============================================================

const MOVE_KEY_MAP = {
  CROSSOVER: 'crossover',
  HESITATION: 'hesitation',
  STEPBACK: 'stepback',
  IN_AND_OUT: 'inAndOut',
  LEGS_THROUGH: 'legsThrough',
};

class Input {
  constructor() {
    this.pressed = new Set();
    this.events = [];
    window.addEventListener('keydown', (e) => this._onDown(e));
    window.addEventListener('keyup', (e) => this._onUp(e));
  }

  _onDown(e) {
    const isSpace = e.key === ' ' || e.code === 'Space';
    if (isSpace) e.preventDefault();
    if (this.pressed.has(e.key)) return; // ignore auto-repeat
    this.pressed.add(e.key);

    if (isSpace) {
      this.events.push({ type: 'shootDown' });
      return;
    }
    for (const name in MOVE_KEY_MAP) {
      if (KEY[name].includes(e.key)) {
        this.events.push({ type: 'move', name: MOVE_KEY_MAP[name] });
      }
    }
  }

  _onUp(e) {
    const isSpace = e.key === ' ' || e.code === 'Space';
    this.pressed.delete(e.key);
    if (isSpace) {
      e.preventDefault();
      this.events.push({ type: 'shootUp' });
    }
  }

  isDown(name) {
    return KEY[name].some((k) => this.pressed.has(k));
  }

  consumeEvents() {
    const evs = this.events;
    this.events = [];
    return evs;
  }
}
