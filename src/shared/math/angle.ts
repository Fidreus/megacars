// Angle and scalar helpers. Headings are measured clockwise from north,
// with x pointing east and z pointing south (north = -z = up on screen).

import { DMath } from './dmath.ts';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

/** Wrap an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a %= TAU;
  if (a <= -Math.PI) a += TAU;
  else if (a > Math.PI) a -= TAU;
  return a;
}

/** Heading (clockwise from north) of a planar vector. */
export function headingOf(x: number, z: number): number {
  return DMath.atan2(x, -z);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Move `v` toward `target` by at most `maxDelta`. */
export function approach(v: number, target: number, maxDelta: number): number {
  return v < target ? Math.min(v + maxDelta, target) : Math.max(v - maxDelta, target);
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Exponential smoothing factor for a rate `k` (1/s) over `dt` seconds. */
export function expFactor(k: number, dt: number): number {
  return 1 - DMath.exp(-k * dt);
}
