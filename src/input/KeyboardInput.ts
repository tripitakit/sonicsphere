export type KeyAction = 'rotateLeft' | 'rotateRight';

const KEY_MAP: Record<string, KeyAction> = {
  KeyA: 'rotateLeft',   ArrowLeft: 'rotateLeft',
  KeyD: 'rotateRight',  ArrowRight: 'rotateRight',
};

export class KeyboardInput {
  private held = new Set<KeyAction>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      // Don't capture keys when user is typing in an input or textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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

  /** Returns gizmo rotation intent in -1..1. */
  getRotationIntent(): number {
    return (this.isHeld('rotateRight') ? 1 : 0) - (this.isHeld('rotateLeft') ? 1 : 0);
  }
}
