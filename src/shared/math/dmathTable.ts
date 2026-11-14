// Fixed inputs for the deterministic maths, with awkward cases (tiny, huge,
// negative, next to multiples of pi/2). dmath.test.ts pins their exact
// results, and scripts/detCheck.ts compares them between Node and browsers.

import { DMath } from './dmath.ts';

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;

/** The bits of x as 16 hex digits. */
export function bitsOf(x: number): string {
  F[0] = x;
  return U[HI].toString(16).padStart(8, '0') + U[1 - HI].toString(16).padStart(8, '0');
}

function fromBits(hex: string): number {
  U[HI] = parseInt(hex.slice(0, 8), 16);
  U[1 - HI] = parseInt(hex.slice(8), 16);
  return F[0];
}

const PIO2 = Math.PI / 2;
/** One step up (n > 0) or down from x, in units in the last place. */
function nudge(x: number, n: number): number {
  F[0] = x;
  const lo = U[1 - HI] + n;
  return fromBits(bitsOf(x).slice(0, 8) + (lo >>> 0).toString(16).padStart(8, '0'));
}

const ANGLES = [
  0, -0, 1e-300, 5e-324, 1e-9, -1e-9, 7.450580596923828e-9, 0.1, -0.5, 0.6744, 0.7853981633974483, 1, -1, 2, 3, -3,
  PIO2, -PIO2, nudge(PIO2, 1), nudge(PIO2, -1), Math.PI, -Math.PI, nudge(Math.PI, 1), 3 * PIO2, 2 * Math.PI, -2 * Math.PI,
  5 * PIO2, 100 * PIO2, 7.5, -12.25, 1000, 123456.789, 1e6, -1e6, 1.6e6, 1.7e6, 1e9, 1e15, 1e22, -1e22, 1e100, 1.79e308,
];
const ATANS = [0, -0, 1e-30, 0.3, 0.4375, 0.5, -0.69, 1, 1.1875, 1.5, 2.4375, -3, 10, 1e10, 1e30, -1e300, Infinity, -Infinity];
const UNIT = [0, -0, 1e-20, 0.25, -0.4999, 0.5, 0.7, -0.9, 0.975, 0.99999, 1, -1];
const EXPS = [0, -0, 1e-20, -1e-10, 0.1, 0.3465, -0.5, 0.5199, 1, -1, 2.5, 10, -20, 100, -100, 700, 709.7, 709.79, -708, -740, -745.2];
const LOGS = [1, 2, 0.5, 1e-310, 1e-300, 0.1, 0.70710678, 1.41421356, 10, 1e300, 0, Infinity];
const PAIRS: [number, number][] = [
  [0, 0], [-0, 0], [0, -0], [-0, -0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
  [3, 4], [-3, -4], [1e-300, -1], [-1e-300, -1], [1e300, 1e-10], [Infinity, Infinity], [-Infinity, Infinity],
  [Infinity, -Infinity], [5, Infinity], [5, -Infinity], [0.2, 1], [2, 0.5], [0.6, -0.8], [-123.4, 56.7],
];

/** "fn(input bits) = result bits" for every fixed input. */
export function dmathTable(): string[] {
  const rows: string[] = [];
  const one = (name: string, f: (x: number) => number, xs: number[]) => {
    for (const x of xs) rows.push(`${name}(${bitsOf(x)}) = ${bitsOf(f(x))}`);
  };
  one('sin', DMath.sin, ANGLES);
  one('cos', DMath.cos, ANGLES);
  one('tan', DMath.tan, ANGLES);
  one('atan', DMath.atan, ATANS);
  one('asin', DMath.asin, UNIT);
  one('acos', DMath.acos, UNIT);
  one('exp', DMath.exp, EXPS);
  one('log', DMath.log, LOGS);
  for (const [y, x] of PAIRS) rows.push(`atan2(${bitsOf(y)}, ${bitsOf(x)}) = ${bitsOf(DMath.atan2(y, x))}`);
  for (const [y, x] of PAIRS) rows.push(`hypot(${bitsOf(y)}, ${bitsOf(x)}) = ${bitsOf(DMath.hypot(y, x))}`);
  return rows;
}
