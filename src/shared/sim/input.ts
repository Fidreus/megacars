// Per-tick control input for one car. Values are quantised to the precision
// they have on the wire so offline play and online play behave identically.

export const Btn = {
  FireFront: 1,
  FireRear: 2,
  Turbo: 4,
  Switch: 8,
  /** Put the car back on the track (acts on the press). */
  Reset: 16,
  /** Set when steering comes from an analog stick (no keyboard ramp). */
  Analog: 128,
} as const;

export interface CarInput {
  /** -1 (left) .. 1 (right) */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 (also reverse when nearly stopped) */
  brake: number;
  buttons: number;
}

export function neutralInput(): CarInput {
  return { steer: 0, throttle: 0, brake: 0, buttons: 0 };
}

export function copyInput(dst: CarInput, src: CarInput): CarInput {
  dst.steer = src.steer;
  dst.throttle = src.throttle;
  dst.brake = src.brake;
  dst.buttons = src.buttons;
  return dst;
}

/** Round to i8 / u8 precision in place. */
export function quantizeInput(i: CarInput): CarInput {
  i.steer = Math.round(Math.max(-1, Math.min(1, i.steer)) * 127) / 127;
  i.throttle = Math.round(Math.max(0, Math.min(1, i.throttle)) * 255) / 255;
  i.brake = Math.round(Math.max(0, Math.min(1, i.brake)) * 255) / 255;
  i.buttons &= 0xff;
  return i;
}

export const NEUTRAL_INPUT: Readonly<CarInput> = Object.freeze(neutralInput());
