// Default key bindings. Never Ctrl/Alt/Cmd (OS shortcuts) or Shift (sticky keys).

export interface KeyBinding {
  left: readonly string[];
  right: readonly string[];
  gas: readonly string[];
  brake: readonly string[];
  fireFront: readonly string[];
  fireRear: readonly string[];
  turbo: readonly string[];
  reset: readonly string[];
  drift: readonly string[];
}

/** Single player: arrows or WASD, weapons on the other hand. */
export const SOLO_KEYS: KeyBinding = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  gas: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  fireFront: ['Space', 'KeyK'],
  fireRear: ['KeyJ', 'KeyX'],
  turbo: ['KeyL', 'KeyC'],
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
  reset: ['Enter', 'NumpadEnter'],
  drift: ['KeyL', 'Numpad3'],
};
