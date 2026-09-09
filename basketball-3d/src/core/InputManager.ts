/**
 * Central input source. Nothing else reads window keyboard events directly -
 * gameplay code asks InputManager for a named *action*, so rebinding a key
 * later never touches PlayerController/CameraController.
 */
export type InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'sprint'
  | 'jump'
  | 'pass'
  | 'shoot'
  | 'crossover'
  | 'spin'
  | 'hesitation'
  | 'stepback'
  | 'inAndOut'
  | 'legsThrough'
  | 'switchPlayer'
  | 'toggleDebug';

const DEFAULT_BINDINGS: Record<InputAction, string[]> = {
  moveForward: ['KeyW', 'ArrowUp'],
  moveBackward: ['KeyS', 'ArrowDown'],
  moveLeft: ['KeyA', 'ArrowLeft'],
  moveRight: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  pass: ['KeyE'],
  shoot: ['KeyF'],
  crossover: ['KeyQ'],
  spin: ['KeyR'],
  hesitation: ['KeyC'],
  stepback: ['KeyV'],
  inAndOut: ['KeyX'],
  legsThrough: ['KeyZ'],
  switchPlayer: ['Tab'],
  toggleDebug: ['F1'],
};

export class InputManager {
  private bindings: Record<InputAction, string[]> = structuredClone(DEFAULT_BINDINGS);
  private pressedCodes = new Set<string>();
  private pressedThisFrame = new Set<string>();
  private releasedThisFrame = new Set<string>();

  /** Normalized [-1,1] movement axes derived from move* actions, x=strafe, y=forward. */
  readonly moveAxis = { x: 0, y: 0 };

  constructor(private readonly target: Window = window) {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
  }

  rebind(action: InputAction, codes: string[]): void {
    this.bindings[action] = codes;
  }

  isDown(action: InputAction): boolean {
    return this.bindings[action].some((code) => this.pressedCodes.has(code));
  }

  wasPressedThisFrame(action: InputAction): boolean {
    return this.bindings[action].some((code) => this.pressedThisFrame.has(code));
  }

  wasReleasedThisFrame(action: InputAction): boolean {
    return this.bindings[action].some((code) => this.releasedThisFrame.has(code));
  }

  /** Call once per render frame after gameplay has read this frame's edge events. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();

    const forward = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBackward') ? 1 : 0);
    const strafe = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
    const len = Math.hypot(forward, strafe) || 1;
    this.moveAxis.x = strafe / len;
    this.moveAxis.y = forward / len;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.pressedCodes.has(e.code)) {
      this.pressedThisFrame.add(e.code);
    }
    this.pressedCodes.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Tab') {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.pressedCodes.delete(e.code);
    this.releasedThisFrame.add(e.code);
  };

  private onBlur = (): void => {
    this.pressedCodes.clear();
  };
}
