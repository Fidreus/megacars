// Controls screen: rebind the keyboard (single player and both split-screen
// players) and the gamepad. Pick a row, choose slot 1 or 2 with left/right,
// confirm, then press the new key or button. A key already used by another
// action moves over (that action loses it, and you are told).

import {
  ACTION_NAMES, ACTIONS, buttonName, defaultControls, keyName, PAD_ACTIONS, RESERVED_BUTTONS, RESERVED_KEYS,
  saveControls, type Action, type Controls, type KeySet, type PadAction,
} from '../../input/bindings.ts';
import { newPadButton } from '../../input/gamepad.ts';
import type { Keyboard } from '../../input/keyboard.ts';
import type { NavState } from '../../input/nav.ts';
import { drawText } from '../font.ts';
import { Menu, type MenuEvents, type MenuItem } from '../menu.ts';

type SetId = KeySet | 'pad';
const SETS: SetId[] = ['solo', 'p1', 'p2', 'pad'];
const SET_NAMES: Record<SetId, string> = {
  solo: 'KEYBOARD - ONE PLAYER',
  p1: 'KEYBOARD - SPLIT LEFT',
  p2: 'KEYBOARD - SPLIT RIGHT',
  pad: 'GAMEPAD',
};

interface Capture {
  action: Action;
  slot: number;
  /** Index into this frame's key presses after the one that started it. */
  from: number;
}

export class ControlsScreen {
  readonly menu: Menu;
  set: SetId = 'solo';
  private slot = 0;
  private capture: Capture | null = null;
  private message = '';
  private messageTime = 0;
  private readonly padPrev: boolean[][] = [];
  private readonly controls: Controls;
  private readonly keyboard: Keyboard;
  private readonly onBack: () => void;
  private readonly onSound: (kind: 'change' | 'deny' | 'buy') => void;

  constructor(
    controls: Controls,
    keyboard: Keyboard,
    events: MenuEvents,
    onBack: () => void,
    onSound: (kind: 'change' | 'deny' | 'buy') => void,
  ) {
    this.controls = controls;
    this.keyboard = keyboard;
    this.onBack = onBack;
    this.onSound = onSound;
    this.menu = new Menu(this.items(), events);
  }

  /** A key or button is being waited for: nothing else should react to input. */
  get capturing(): boolean {
    return this.capture !== null;
  }

  private actions(): readonly Action[] {
    return this.set === 'pad' ? PAD_ACTIONS : ACTIONS;
  }

  private items(): MenuItem[] {
    const rows: MenuItem[] = [
      {
        label: () => `SET: ${SET_NAMES[this.set]}`,
        change: (d) => {
          this.set = SETS[(SETS.indexOf(this.set) + d + SETS.length) % SETS.length];
          this.menu.items = this.items();
        },
      },
    ];
    for (const a of this.actions()) {
      rows.push({
        label: () => this.rowLabel(a),
        change: (d) => (this.slot = Math.max(0, Math.min(1, this.slot + d))),
        select: () => this.start(a),
      });
    }
    rows.push(
      {
        label: () => 'RESET THIS SET TO DEFAULTS',
        select: () => {
          const def = defaultControls();
          if (this.set === 'pad') this.controls.pad = def.pad;
          else this.controls[this.set] = def[this.set];
          saveControls(this.controls);
          this.say('DEFAULTS RESTORED');
        },
      },
      { label: () => 'BACK', select: () => this.onBack() },
    );
    return rows;
  }

  private names(a: Action): string[] {
    if (this.set === 'pad') return (this.controls.pad[a as PadAction] ?? []).map(buttonName);
    return this.controls[this.set][a].map(keyName);
  }

  private rowLabel(a: Action): string {
    const names = this.names(a);
    // Row 0 is the set picker, so action i is menu row i + 1.
    const selected = this.actions()[this.menu.index - 1] === a;
    const cell = (i: number) => {
      const waiting = this.capture?.action === a && this.capture.slot === i;
      const text = waiting ? '?' : (names[i] ?? '-');
      const padded = text.padEnd(9).slice(0, 9);
      return selected && this.slot === i ? `[${padded}]` : ` ${padded} `;
    };
    return `${ACTION_NAMES[a].padEnd(15)}${cell(0)}${cell(1)}`;
  }

  private start(a: Action): void {
    // Keys pressed after the confirm key in the same frame still count.
    const p = this.keyboard.presses;
    const confirm = Math.max(p.lastIndexOf('Enter'), p.lastIndexOf('NumpadEnter'), p.lastIndexOf('Space'));
    this.capture = { action: a, slot: this.slot, from: confirm >= 0 ? confirm + 1 : p.length };
    newPadButton(this.padPrev); // snapshot, so the button that confirmed doesn't count
  }

  private say(msg: string): void {
    this.message = msg;
    this.messageTime = 3;
  }

  handle(nav: NavState): void {
    if (!this.capture) {
      if (nav.back) {
        this.onBack();
        return;
      }
      this.menu.handle(nav);
      if (!this.capture) return;
    } else {
      this.capture.from = 0;
    }
    const c = this.capture;
    if (this.set === 'pad') {
      const button = newPadButton(this.padPrev);
      if (button >= 0) {
        if (RESERVED_BUTTONS.has(button)) {
          this.say(`${buttonName(button)} IS RESERVED (START PAUSES, D-PAD STEERS)`);
          this.onSound('deny');
        } else {
          this.assign(c, button);
          return;
        }
      }
    }
    for (const key of this.keyboard.presses.slice(c.from)) {
      if (key === 'Escape') {
        this.capture = null;
        return;
      }
      if (key === 'Delete' || key === 'Backspace') {
        this.list(c.action).splice(c.slot, 1);
        saveControls(this.controls);
        this.capture = null;
        return;
      }
      if (this.set === 'pad') continue;
      if (RESERVED_KEYS.has(key)) {
        this.say(`${keyName(key)} IS RESERVED - PICK ANOTHER KEY`);
        this.onSound('deny');
        continue;
      }
      this.assign(c, key);
      return;
    }
  }

  private list(a: Action): (string | number)[] {
    return this.set === 'pad' ? this.controls.pad[a as PadAction] : this.controls[this.set][a];
  }

  private assign(c: Capture, value: string | number): void {
    const moved: string[] = [];
    const name = typeof value === 'number' ? buttonName(value) : keyName(value);
    // Take it away from any other action in this set...
    for (const a of this.actions()) {
      if (a === c.action) continue;
      const l = this.list(a);
      const i = l.indexOf(value);
      if (i >= 0) {
        l.splice(i, 1);
        moved.push(ACTION_NAMES[a]);
      }
    }
    // ...and from the other split-screen player, who plays at the same time.
    if (this.set === 'p1' || this.set === 'p2') {
      const other = this.controls[this.set === 'p1' ? 'p2' : 'p1'];
      for (const a of ACTIONS) {
        const i = other[a].indexOf(value as string);
        if (i >= 0) {
          other[a].splice(i, 1);
          moved.push(`OTHER PLAYER'S ${ACTION_NAMES[a]}`);
        }
      }
    }
    const l = this.list(c.action);
    const own = l.indexOf(value);
    if (own >= 0) {
      // Already on this action in the other slot: swap the two.
      if (own !== c.slot && c.slot < l.length) [l[own], l[c.slot]] = [l[c.slot], value];
    } else if (c.slot < l.length) {
      l[c.slot] = value;
    } else {
      l.push(value);
    }
    saveControls(this.controls);
    this.capture = null;
    this.onSound('buy');
    if (moved.length) this.say(`${name} TAKEN FROM ${moved.join(', ')}`);
    else this.say(`${ACTION_NAMES[c.action]}: ${name}`);
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number, top: number, dt: number): void {
    this.messageTime -= dt;
    drawText(ctx, 'CONTROLS', W / 2, top, { scale: 2, color: '#ffffff', align: 'center' });
    const scale = top + 30 + this.menu.items.length * 22 <= H - 34 ? 2 : 1;
    this.menu.draw(ctx, W / 2, top + 30, scale, dt);
    const c = this.capture;
    const what = this.set === 'pad' ? 'BUTTON' : 'KEY';
    const hint = c
      ? `PRESS A ${what} FOR ${ACTION_NAMES[c.action]}   ESC CANCEL   DEL CLEAR`
      : this.set === 'pad'
        ? 'STEERING IS ALWAYS THE LEFT STICK AND D-PAD   START PAUSES'
        : '←/→ PICK SLOT   ENTER CHANGE   ESC BACK';
    drawText(ctx, hint, W / 2, H - 22, { color: c ? '#ffd84a' : '#8090a8', align: 'center' });
    if (this.messageTime > 0) drawText(ctx, this.message, W / 2, H - 11, { color: '#9fd8ff', align: 'center' });
    else if (this.set === 'pad') {
      const pads = (navigator.getGamepads?.() ?? []).filter((p) => !!p);
      drawText(ctx, pads.length ? `CONNECTED: ${pads.length} GAMEPAD${pads.length > 1 ? 'S' : ''}` : 'NO GAMEPAD FOUND - PRESS A BUTTON ON IT', W / 2, H - 11, { color: '#8090a8', align: 'center' });
    }
  }
}
