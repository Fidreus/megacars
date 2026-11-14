// Key and gamepad bindings: defaults, the player's own (saved in
// localStorage), and names for showing them. Never Ctrl/Alt/Cmd (OS
// shortcuts) or Shift (sticky keys).

export const ACTIONS = ['left', 'right', 'gas', 'brake', 'drift', 'fireFront', 'fireRear', 'turbo', 'special', 'reset'] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_NAMES: Record<Action, string> = {
  left: 'STEER LEFT',
  right: 'STEER RIGHT',
  gas: 'ACCELERATE',
  brake: 'BRAKE / REVERSE',
  drift: 'DRIFT',
  fireFront: 'MISSILE',
  fireRear: 'MINE',
  turbo: 'TURBO',
  special: 'SPECIAL ITEM',
  reset: 'RESET CAR',
};

/** Up to two keys (KeyboardEvent.code) per action. */
export type KeyBinding = Record<Action, string[]>;

/** Pad actions (steering is always the left stick and d-pad left/right). */
export const PAD_ACTIONS = ['gas', 'brake', 'drift', 'fireFront', 'fireRear', 'turbo', 'special', 'reset'] as const;
export type PadAction = (typeof PAD_ACTIONS)[number];
/** Up to two buttons (standard mapping index) per action. */
export type PadBinding = Record<PadAction, number[]>;

/** Single player: arrows or WASD, weapons on the other hand. */
export const SOLO_KEYS: KeyBinding = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  gas: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  fireFront: ['Space', 'KeyK'],
  fireRear: ['KeyJ', 'KeyX'],
  turbo: ['KeyL', 'KeyC'],
  special: ['KeyI', 'KeyV'],
  reset: ['KeyR'],
  drift: ['KeyZ', 'KeyB'],
};

/** Split screen, left player. */
export const P1_KEYS: KeyBinding = {
  left: ['KeyA'],
  right: ['KeyD'],
  gas: ['KeyW'],
  brake: ['KeyS'],
  fireFront: ['KeyG'],
  fireRear: ['KeyF'],
  turbo: ['KeyH'],
  special: ['KeyV'],
  reset: ['KeyR'],
  drift: ['KeyQ'],
};

/** Split screen, right player. */
export const P2_KEYS: KeyBinding = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  gas: ['ArrowUp'],
  brake: ['ArrowDown'],
  fireFront: ['Period', 'Numpad0'],
  fireRear: ['Comma', 'Numpad1'],
  turbo: ['Slash', 'Numpad2'],
  special: ['KeyK', 'Numpad4'],
  reset: ['Enter', 'NumpadEnter'],
  drift: ['KeyL', 'Numpad3'],
};

/** A/RT gas, B/LT brake, X/RB missile, Y/d-pad down mine, d-pad up/L3 turbo, R3 special, LB drift, Select reset. */
export const PAD_DEFAULT: PadBinding = {
  gas: [7, 0],
  brake: [6, 1],
  fireFront: [2, 5],
  fireRear: [3, 13],
  turbo: [12, 10],
  special: [11],
  drift: [4],
  reset: [8],
};

export interface Controls {
  solo: KeyBinding;
  p1: KeyBinding;
  p2: KeyBinding;
  pad: PadBinding;
}

export type KeySet = 'solo' | 'p1' | 'p2';

const KEY = 'megacars.controls.v1';

function copy<T extends Record<string, unknown[]>>(b: T): T {
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [...v]])) as T;
}

export function defaultControls(): Controls {
  return { solo: copy(SOLO_KEYS), p1: copy(P1_KEYS), p2: copy(P2_KEYS), pad: copy(PAD_DEFAULT) };
}

export function loadControls(): Controls {
  const c = defaultControls();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return c;
    const saved = JSON.parse(raw) as Partial<Controls>;
    for (const set of ['solo', 'p1', 'p2'] as const) {
      for (const a of ACTIONS) {
        const v = saved[set]?.[a];
        if (Array.isArray(v) && v.every((k) => typeof k === 'string')) c[set][a] = v.slice(0, 2);
      }
    }
    // The two split-screen sets share one keyboard.
    keepNewDefaults(c.solo, saved.solo);
    keepNewDefaults(c.p1, saved.p1, c.p2);
    keepNewDefaults(c.p2, saved.p2, c.p1);
    for (const a of PAD_ACTIONS) {
      const v = saved.pad?.[a];
      if (Array.isArray(v) && v.every((k) => Number.isInteger(k))) c.pad[a] = v.slice(0, 2);
    }
    keepNewDefaults(c.pad, saved.pad);
  } catch {
    // Corrupt or blocked: defaults.
  }
  return c;
}

/**
 * Actions added after a player saved their own bindings get their defaults,
 * minus any key or button the player has since given to something else.
 */
function keepNewDefaults<T extends string | number>(
  b: Record<string, T[]>, saved: Partial<Record<string, unknown>> | undefined, also?: Record<string, T[]>,
): void {
  if (!saved) return;
  for (const a of Object.keys(b)) {
    if (a in saved) continue;
    const taken = (k: T) => Object.entries(b).some(([o, ks]) => o !== a && ks.includes(k)) || Object.values(also ?? {}).some((ks) => ks.includes(k));
    b[a] = b[a].filter((k) => !taken(k));
  }
}

export function saveControls(c: Controls): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // Not remembered, still works this session.
  }
}

/** Keys the game itself uses (pause, debug toggles) or that the OS grabs. */
export const RESERVED_KEYS = new Set([
  'Escape', 'KeyP', 'Tab', 'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyM', 'KeyN',
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
  'CapsLock', 'ContextMenu', 'F1', 'F3', 'F5', 'F11', 'F12',
]);

/** Start pauses; d-pad left/right steer. */
export const RESERVED_BUTTONS = new Set([9, 14, 15]);

const KEY_NAMES: Record<string, string> = {
  ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
  Space: 'SPACE', Enter: 'ENTER', NumpadEnter: 'NUM ENTER', Backspace: 'BACKSPACE',
  Period: '.', Comma: ',', Slash: '-', Minus: '+', Equal: 'ACCENT', Semicolon: 'Ö', Quote: 'Ä',
  BracketLeft: 'Å', BracketRight: 'TREMA', Backslash: "'", Backquote: 'SECTION', IntlBackslash: '<',
  Insert: 'INS', Delete: 'DEL', Home: 'HOME', End: 'END', PageUp: 'PG UP', PageDown: 'PG DN',
  NumpadAdd: 'NUM +', NumpadSubtract: 'NUM -', NumpadMultiply: 'NUM *', NumpadDivide: 'NUM /', NumpadDecimal: 'NUM ,',
};

/** Short, readable name of a key code (Swedish layout labels for symbols). */
export function keyName(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}

const BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'L3', 'R3', 'D-UP', 'D-DOWN', 'D-LEFT', 'D-RIGHT', 'HOME'];

export function buttonName(i: number): string {
  return BUTTON_NAMES[i] ?? `BUTTON ${i}`;
}

/** "SPACE / K" style list of an action's keys. */
export function keysLabel(b: KeyBinding, a: Action): string {
  return b[a].length ? b[a].map(keyName).join('/') : '-';
}
