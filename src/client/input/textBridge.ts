// Phones only show their keyboard for a real text box, so a canvas text
// field (player name, room code) gets a hidden <input> while it is edited.

export interface TextField {
  get(): string;
  set(v: string): void;
  max: number;
  allowed: RegExp;
}

export class TextBridge {
  private readonly input: HTMLInputElement;
  private field: TextField | null = null;
  /** Enter on the phone keyboard (one-shot, cleared by the reader). */
  submitted = false;
  /** The text field under a tap (client coordinates), or null. */
  pick: ((clientX: number, clientY: number) => TextField | null) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    // iPhones only show the keyboard when focus happens inside the tap itself.
    // touchend (not pointerup) so the emulated mouse click that follows can be
    // cancelled: it would focus the canvas and close the keyboard again.
    canvas.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const field = t ? this.pick?.(t.clientX, t.clientY) : null;
      if (!field) return;
      e.preventDefault();
      this.edit(field);
    }, { passive: false });
    const el = document.createElement('input');
    el.type = 'text';
    el.autocomplete = 'off';
    el.autocapitalize = 'characters';
    el.spellcheck = false;
    el.enterKeyHint = 'done';
    // 16px stops iOS zooming in; off-screen but focusable.
    el.style.cssText = 'position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;';
    document.body.appendChild(el);
    el.addEventListener('input', () => {
      if (!this.field) return;
      let v = '';
      for (const ch of el.value.toUpperCase()) if (this.field.allowed.test(ch) && v.length < this.field.max) v += ch;
      this.field.set(v);
      if (el.value !== v) el.value = v;
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.submitted = true;
        this.close();
      }
    });
    el.addEventListener('blur', () => (this.field = null));
    this.input = el;
  }

  get open(): boolean {
    return this.field !== null;
  }

  edit(field: TextField): void {
    this.field = field;
    this.input.value = field.get();
    this.input.focus();
  }

  close(): void {
    this.field = null;
    this.input.blur();
  }
}
