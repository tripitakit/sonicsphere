export type KeyAction = 'forward' | 'back' | 'left' | 'right';

const KEY_MAP: Record<string, KeyAction> = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back',    ArrowDown: 'back',
  KeyA: 'left',    ArrowLeft: 'left',
  KeyD: 'right',   ArrowRight: 'right',
};

export class KeyboardInput {
  private held = new Set<KeyAction>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      const action = KEY_MAP[e.code];
      if (action) {
        e.preventDefault();
        this.held.add(action);
      }
    });
    window.addEventListener('keyup', (e) => {
      const action = KEY_MAP[e.code];
      if (action) this.held.delete(action);
    });
  }

  isHeld(action: KeyAction): boolean {
    return this.held.has(action);
  }

  /** Returns movement intent: forward in -1..1, turn in -1..1 */
  getIntent(): { forward: number; turn: number } {
    return {
      forward: (this.isHeld('forward') ? 1 : 0) - (this.isHeld('back') ? 1 : 0),
      turn:    (this.isHeld('right')   ? 1 : 0) - (this.isHeld('left') ? 1 : 0),
    };
  }
}
