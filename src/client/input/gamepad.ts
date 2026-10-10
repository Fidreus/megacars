// Gamepad API polling with the "standard" mapping (Xbox/PlayStation pads).

import { PAD_DEFAULT, type PadBinding } from './bindings.ts';

export interface PadState {
  connected: boolean;
  steer: number;
  throttle: number;
  brake: number;
  fireFront: boolean;
  fireRear: boolean;
  turbo: boolean;
  drift: boolean;
  reset: boolean;
  /** Any input this frame (used to pick keyboard vs pad). */
  active: boolean;
}

const DEADZONE = 0.12;

export function readPad(index: number, out: PadState, bind: PadBinding = PAD_DEFAULT): PadState {
  const pads = navigator.getGamepads?.() ?? [];
  const gp = pads[index];
  out.connected = !!gp;
  out.active = false;
  out.steer = out.throttle = out.brake = 0;
  out.fireFront = out.fireRear = out.turbo = out.drift = out.reset = false;
  if (!gp) return out;
  const b = (i: number) => gp.buttons[i];
  const val = (i: number) => (b(i) ? b(i).value : 0);
  const pressed = (i: number) => (b(i) ? b(i).pressed : false);
  let x = gp.axes[0] ?? 0;
  if (Math.abs(x) < DEADZONE) x = 0;
  else x = Math.sign(x) * ((Math.abs(x) - DEADZONE) / (1 - DEADZONE));
  // Response curve x·|x|^0.6: fine control near centre, full lock at the edge.
  x = Math.sign(x) * Math.pow(Math.abs(x), 1.6);
  if (pressed(14)) x = -1;
  if (pressed(15)) x = 1;
  out.steer = x;
  const value = (bs: number[]) => bs.reduce((m, i) => Math.max(m, val(i), pressed(i) ? 1 : 0), 0);
  const any = (bs: number[]) => bs.some(pressed);
  out.throttle = value(bind.gas);
  out.brake = value(bind.brake);
  out.fireFront = any(bind.fireFront);
  out.fireRear = any(bind.fireRear);
  out.turbo = any(bind.turbo);
  out.drift = any(bind.drift);
  out.reset = any(bind.reset);
  out.active = x !== 0 || out.throttle > 0.05 || out.brake > 0.05 || out.fireFront || out.fireRear || out.turbo || out.drift || out.reset;
  return out;
}

export function makePadState(): PadState {
  return { connected: false, steer: 0, throttle: 0, brake: 0, fireFront: false, fireRear: false, turbo: false, drift: false, reset: false, active: false };
}

/** A button newly pressed on any pad this frame (for rebinding), or -1. */
export function newPadButton(prev: boolean[][]): number {
  const pads = navigator.getGamepads?.() ?? [];
  let hit = -1;
  pads.forEach((gp, p) => {
    if (!gp) return;
    const now = gp.buttons.map((b) => b.pressed);
    const before = prev[p] ?? [];
    now.forEach((down, i) => {
      if (down && !before[i] && hit < 0) hit = i;
    });
    prev[p] = now;
  });
  return hit;
}
