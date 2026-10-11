// Menu navigation from keyboard, gamepads and mouse, as one-shot actions per
// frame (with auto-repeat when a direction is held on a pad).

import type { Keyboard } from './keyboard.ts';

export interface NavState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  /** Pause during a race: Escape, P or a pad's Start (B is the brake there). */
  pause: boolean;
  /** Pointer position in low-res UI pixels, and a click this frame. */
  pointerX: number;
  pointerY: number;
  pointerMoved: boolean;
  click: boolean;
  /** Vertical swipe (touch) or mouse wheel this frame, UI pixels; + = content moves down. */
  scrollY: number;
  /** Text typed this frame and Backspace (only in text mode). */
  typed: string;
  erase: boolean;
}

const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 0.09;
/** UI pixels a finger moves before a touch counts as a swipe rather than a tap. */
const SWIPE_START = 7;

export class Nav {
  readonly state: NavState = {
    up: false, down: false, left: false, right: false, confirm: false, back: false, pause: false,
    pointerX: -1, pointerY: -1, pointerMoved: false, click: false, scrollY: 0, typed: '', erase: false,
  };
  /** A text field has focus: letters type instead of navigating. */
  textMode = false;
  private readonly keyboard: Keyboard;
  private readonly held = new Map<string, number>();
  private padButtons: boolean[] = [];
  private clicked = false;
  private moved = false;
  private scroll = 0;
  /** A finger on the screen: where it went down, and whether it has turned into a swipe. */
  private touch: { id: number; y0: number; lastY: number; swiping: boolean } | null = null;
  /** Converts client coordinates to UI pixels. */
  toUi: (clientX: number, clientY: number) => [number, number] = (x, y) => [x, y];

  constructor(keyboard: Keyboard, canvas: HTMLCanvasElement) {
    this.keyboard = keyboard;
    // Touch: a tap is a click when the finger lifts; dragging up or down
    // scrolls instead. A mouse clicks on press and hovers as it moves.
    canvas.addEventListener('pointermove', (e) => {
      const [x, y] = this.toUi(e.clientX, e.clientY);
      const t = this.touch;
      if (e.pointerType === 'touch') {
        if (!t || t.id !== e.pointerId) return;
        if (!t.swiping && Math.abs(y - t.y0) > SWIPE_START) t.swiping = true;
        if (t.swiping) this.scroll += y - t.lastY;
        t.lastY = y;
        return;
      }
      [this.state.pointerX, this.state.pointerY] = [x, y];
      this.moved = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = this.toUi(e.clientX, e.clientY);
      if (e.pointerType === 'touch') {
        this.touch = { id: e.pointerId, y0: y, lastY: y, swiping: false };
        return;
      }
      [this.state.pointerX, this.state.pointerY] = [x, y];
      this.clicked = true;
    });
    const lift = (e: PointerEvent) => {
      const t = this.touch;
      if (e.pointerType !== 'touch' || !t || t.id !== e.pointerId) return;
      this.touch = null;
      if (t.swiping || e.type === 'pointercancel') return;
      [this.state.pointerX, this.state.pointerY] = this.toUi(e.clientX, e.clientY);
      this.clicked = true;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);
    canvas.addEventListener('wheel', (e) => {
      // One notch is about one menu row.
      this.scroll -= Math.sign(e.deltaY) * Math.min(40, Math.abs(e.deltaY) / 4 + 6);
    }, { passive: true });
  }

  /** Read this frame's navigation actions. */
  poll(dt: number): NavState {
    const kb = this.keyboard;
    const s = this.state;
    const letters = !this.textMode;
    s.up = kb.wasPressed('ArrowUp') || (letters && kb.wasPressed('KeyW'));
    s.down = kb.wasPressed('ArrowDown') || (letters && kb.wasPressed('KeyS'));
    s.left = kb.wasPressed('ArrowLeft') || (letters && kb.wasPressed('KeyA'));
    s.right = kb.wasPressed('ArrowRight') || (letters && kb.wasPressed('KeyD'));
    s.confirm = kb.wasPressed('Enter') || (letters && kb.wasPressed('Space')) || kb.wasPressed('NumpadEnter');
    s.back = kb.wasPressed('Escape') || (letters && kb.wasPressed('Backspace'));
    s.pause = kb.wasPressed('Escape') || kb.wasPressed('KeyP');
    s.typed = this.textMode ? kb.typed : '';
    s.erase = this.textMode && kb.wasPressed('Backspace');
    s.click = this.clicked;
    s.pointerMoved = this.moved;
    s.scrollY = this.scroll;
    this.clicked = false;
    this.moved = false;
    this.scroll = 0;

    // Gamepads: d-pad / left stick with repeat, A = confirm, B / Start = back.
    const pads = navigator.getGamepads?.() ?? [];
    let dirUp = false, dirDown = false, dirLeft = false, dirRight = false;
    const buttons: boolean[] = [];
    for (const gp of pads) {
      if (!gp) continue;
      const b = (i: number) => !!gp.buttons[i]?.pressed;
      dirUp ||= b(12) || (gp.axes[1] ?? 0) < -0.5;
      dirDown ||= b(13) || (gp.axes[1] ?? 0) > 0.5;
      dirLeft ||= b(14) || (gp.axes[0] ?? 0) < -0.5;
      dirRight ||= b(15) || (gp.axes[0] ?? 0) > 0.5;
      buttons[0] ||= b(0);
      buttons[1] ||= b(1);
      buttons[9] ||= b(9);
    }
    s.up ||= this.repeat('up', dirUp, dt);
    s.down ||= this.repeat('down', dirDown, dt);
    s.left ||= this.repeat('left', dirLeft, dt);
    s.right ||= this.repeat('right', dirRight, dt);
    s.confirm ||= !!buttons[0] && !this.padButtons[0];
    s.back ||= (!!buttons[1] && !this.padButtons[1]) || (!!buttons[9] && !this.padButtons[9]);
    s.pause ||= !!buttons[9] && !this.padButtons[9];
    this.padButtons = buttons;
    return s;
  }

  private repeat(key: string, down: boolean, dt: number): boolean {
    if (!down) {
      this.held.delete(key);
      return false;
    }
    const t = this.held.get(key);
    if (t === undefined) {
      this.held.set(key, -REPEAT_DELAY);
      return true;
    }
    const nt = t + dt;
    if (nt >= REPEAT_RATE) {
      this.held.set(key, 0);
      return true;
    }
    this.held.set(key, nt);
    return false;
  }
}
