// Gamepad API polling with the "standard" mapping (Xbox/PlayStation pads).

export interface PadState {
  connected: boolean;
  steer: number;
  throttle: number;
  brake: number;
  fireFront: boolean;
  fireRear: boolean;
  turbo: boolean;
  /** Any input this frame (used to pick keyboard vs pad). */
  active: boolean;
}

const DEADZONE = 0.12;

export function readPad(index: number, out: PadState): PadState {
  const pads = navigator.getGamepads?.() ?? [];
  const gp = pads[index];
  out.connected = !!gp;
  out.active = false;
  out.steer = out.throttle = out.brake = 0;
  out.fireFront = out.fireRear = out.turbo = false;
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
  out.throttle = Math.max(val(7), pressed(0) ? 1 : 0);
  out.brake = Math.max(val(6), pressed(1) ? 1 : 0);
  out.fireFront = pressed(2) || pressed(5);
  out.fireRear = pressed(3) || pressed(4);
  out.turbo = pressed(10);
  out.active = x !== 0 || out.throttle > 0.05 || out.brake > 0.05 || out.fireFront || out.fireRear || out.turbo;
  return out;
}

export function makePadState(): PadState {
  return { connected: false, steer: 0, throttle: 0, brake: 0, fireFront: false, fireRear: false, turbo: false, active: false };
}
