// Keyboard state by physical key (KeyboardEvent.code), so bindings work the
// same on Swedish, US and other layouts.

const GAME_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab',
]);

export class Keyboard {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  /** Printable characters typed this frame (for text fields). */
  typed = '';

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      if (e.key.length === 1) this.typed += e.key;
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  anyDown(codes: readonly string[]): boolean {
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  /** True once per physical press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  get anyPressed(): boolean {
    return this.pressed.size > 0;
  }

  endFrame(): void {
    this.pressed.clear();
    this.typed = '';
  }
}
