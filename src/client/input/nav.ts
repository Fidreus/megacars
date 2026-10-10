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
  /** Pointer position in low-res UI pixels, and a click this frame. */
  pointerX: number;
  pointerY: number;
  pointerMoved: boolean;
  click: boolean;
}

const REPEAT_DELAY = 0.35;
const REPEAT_RATE = 0.09;

export class Nav {
  readonly state: NavState = {
    up: false, down: false, left: false, right: false, confirm: false, back: false,
    pointerX: -1, pointerY: -1, pointerMoved: false, click: false,
  };
  private readonly keyboard: Keyboard;
  private readonly held = new Map<string, number>();
  private padButtons: boolean[] = [];
  private clicked = false;
  private moved = false;
  /** Converts client coordinates to UI pixels. */
  toUi: (clientX: number, clientY: number) => [number, number] = (x, y) => [x, y];

  constructor(keyboard: Keyboard, canvas: HTMLCanvasElement) {
    this.keyboard = keyboard;
    canvas.addEventListener('pointermove', (e) => {
      [this.state.pointerX, this.state.pointerY] = this.toUi(e.clientX, e.clientY);
      this.moved = true;
    });
    canvas.addEventListener('pointerdown', (e) => {
      [this.state.pointerX, this.state.pointerY] = this.toUi(e.clientX, e.clientY);
      this.clicked = true;
    });
  }

  /** Read this frame's navigation actions. */
  poll(dt: number): NavState {
    const kb = this.keyboard;
    const s = this.state;
    s.up = kb.wasPressed('ArrowUp') || kb.wasPressed('KeyW');
    s.down = kb.wasPressed('ArrowDown') || kb.wasPressed('KeyS');
    s.left = kb.wasPressed('ArrowLeft') || kb.wasPressed('KeyA');
    s.right = kb.wasPressed('ArrowRight') || kb.wasPressed('KeyD');
    s.confirm = kb.wasPressed('Enter') || kb.wasPressed('Space') || kb.wasPressed('NumpadEnter');
    s.back = kb.wasPressed('Escape') || kb.wasPressed('Backspace');
    s.click = this.clicked;
    s.pointerMoved = this.moved;
    this.clicked = false;
    this.moved = false;

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
