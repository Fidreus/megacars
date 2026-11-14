// Deterministic maths for the simulation. The JavaScript specification only
// makes + - * /, Math.sqrt and the rounding functions exact; Math.sin, cos,
// atan2, exp, hypot, ** and the rest may differ in the last bits between
// engines (Node, Chrome, Safari, Firefox), and a race amplifies such bits
// until the server and a browser disagree about who won. These are ports of
// the fdlibm algorithms (as in musl) built from exact operations only, so
// they give the same bits everywhere. Errors are below 1 ulp.
//
// Use DMath.* (not Math.*) for anything that feeds the world state; the
// test in dmath.guard.test.ts enforces it for src/shared.
//
// Coefficients and thresholds are written as literals where they are used
// (thresholds as the decimal of fdlibm's high-word bound): V8 then inlines
// these functions, which it does not when they read module constants.
// dmath.test.ts pins the results to the bit.

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
// Typed arrays use the platform's byte order; find the high word once.
const HI = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1 ? 1 : 0;
const LO = 1 - HI;

function highWord(x: number): number {
  F[0] = x;
  return U[HI];
}

function fromWords(hi: number, lo: number): number {
  U[HI] = hi >>> 0;
  U[LO] = lo >>> 0;
  return F[0];
}

/** x with the low 32 bits of its significand cleared. */
function clearLow(x: number): number {
  F[0] = x;
  U[LO] = 0;
  return F[0];
}

/** x * 2^k, exact unless the result overflows or is subnormal (then rounded once). */
function scalbn(x: number, k: number): number {
  let y = x;
  if (k > 1023) {
    y *= 8.98846567431158e+307;
    k -= 1023;
    if (k > 1023) {
      y *= 8.98846567431158e+307;
      k -= 1023;
      if (k > 1023) k = 1023;
    }
  } else if (k < -1022) {
    // Scale by 2^-1022 * 2^53 first so a subnormal result is rounded only once.
    y *= 2.2250738585072014e-308 * 9007199254740992;
    k += 1022 - 53;
    if (k < -1022) {
      y *= 2.2250738585072014e-308 * 9007199254740992;
      k += 1022 - 53;
      if (k < -1022) k = -1022;
    }
  }
  return y * fromWords((0x3ff + k) << 20, 0);
}

// ---------------------------------------------------------------- sin, cos, tan

/** x - n*pi/2 as Y[0] + Y[1] (|Y[0]| <= pi/4); a typed array, so no number boxes are allocated. */
const Y = new Float64Array(2);

/** Reduce x (|x| >= pi/4, finite) by multiples of pi/2; returns n, the result in Y[0] + Y[1]. */
function remPio2(x: number): number {
  const ax = x < 0 ? -x : x;
  // |x| < ~5pi/4, but not within 2^-20 of pi/2 or pi (cancellation: the medium case).
  if (ax < 3.926992416381836 && !(ax >= 1.570796012878418 && ax < 1.5707969665527344) && !(ax >= 3.141592025756836 && ax < 3.1415939331054688)) {
    let z: number;
    if (ax < 2.3561954498291016) { // ~3pi/4
      if (x > 0) {
        z = x - 1.57079632673412561417e+0;
        Y[0] = z - 6.07710050650619224932e-11;
        Y[1] = (z - Y[0]) - 6.07710050650619224932e-11;
        return 1;
      }
      z = x + 1.57079632673412561417e+0;
      Y[0] = z + 6.07710050650619224932e-11;
      Y[1] = (z - Y[0]) + 6.07710050650619224932e-11;
      return -1;
    }
    if (x > 0) {
      z = x - 2 * 1.57079632673412561417e+0;
      Y[0] = z - 2 * 6.07710050650619224932e-11;
      Y[1] = (z - Y[0]) - 2 * 6.07710050650619224932e-11;
      return 2;
    }
    z = x + 2 * 1.57079632673412561417e+0;
    Y[0] = z + 2 * 6.07710050650619224932e-11;
    Y[1] = (z - Y[0]) + 2 * 6.07710050650619224932e-11;
    return -2;
  }
  return remPio2Medium(x, ax);
}

/** remPio2 for everything past 5pi/4 (kept apart so the common case above stays small enough to inline). */
function remPio2Medium(x: number, ax: number): number {
  if (ax < 1647099) { // ~2^20 * pi/2
    // fn = rint(x / (pi/2)), then subtract fn*pi/2 in up to three parts.
    let fn = x * 6.36619772367581382433e-1 + 6755399441055744 - 6755399441055744;
    let n = fn | 0;
    let r = x - fn * 1.57079632673412561417e+0;
    let w = fn * 6.07710050650619224932e-11;
    if (r - w < -7.85398163397448278999e-1) {
      n--;
      fn--;
      r = x - fn * 1.57079632673412561417e+0;
      w = fn * 6.07710050650619224932e-11;
    } else if (r - w > 7.85398163397448278999e-1) {
      n++;
      fn++;
      r = x - fn * 1.57079632673412561417e+0;
      w = fn * 6.07710050650619224932e-11;
    }
    Y[0] = r - w;
    const ex = (highWord(x) >>> 20) & 0x7ff;
    let ey = (highWord(Y[0]) >>> 20) & 0x7ff;
    if (ex - ey > 16) {
      let t = r;
      w = fn * 6.07710050630396597660e-11;
      r = t - w;
      w = fn * 2.02226624879595063154e-21 - ((t - r) - w);
      Y[0] = r - w;
      ey = (highWord(Y[0]) >>> 20) & 0x7ff;
      if (ex - ey > 49) {
        t = r;
        w = fn * 2.02226624871116645580e-21;
        r = t - w;
        w = fn * 8.47842766036889956997e-32 - ((t - r) - w);
        Y[0] = r - w;
      }
    }
    Y[1] = (r - Y[0]) - w;
    return n;
  }
  return remPio2Large(x);
}

// Huge arguments (|x| >= 2^20 * pi/2, never seen in a race) are reduced
// exactly with BigInt, which the specification also makes exact.
const W = 1400;
let TWO_OVER_PI = 0n;
let PIO2_BIG = 0n;

function arctanInv(n: bigint, bits: bigint): bigint {
  const n2 = n * n;
  let term = (1n << bits) / n;
  let sum = term;
  for (let k = 3n; term !== 0n; k += 2n) {
    term /= n2;
    sum += (k & 2n ? -term : term) / k;
  }
  return sum;
}

function remPio2Large(x: number): number {
  if (TWO_OVER_PI === 0n) {
    const g = BigInt(W + 64);
    // Machin: pi = 16 atan(1/5) - 4 atan(1/239), with 64 guard bits.
    const pi = (16n * arctanInv(5n, g) - 4n * arctanInv(239n, g)) >> 64n;
    TWO_OVER_PI = (1n << BigInt(2 * W + 1)) / pi;
    PIO2_BIG = pi >> BigInt(W - 128 + 1);
  }
  const neg = x < 0;
  const hi = highWord(x);
  F[0] = x;
  const lo = U[LO];
  const e = ((hi >>> 20) & 0x7ff) - 1075;
  const m = (BigInt((hi & 0xfffff) | 0x100000) << 32n) | BigInt(lo);
  // |x| * 2/pi = m * TWO_OVER_PI * 2^(e - W)
  const p = m * TWO_OVER_PI;
  const s = BigInt(W - e);
  let n = p >> s;
  let f = (p - (n << s)) >> (s - 192n);
  if (f >= 1n << 191n) {
    f -= 1n << 192n;
    n += 1n;
  }
  // f / 2^192 * pi/2, scaled by 2^320 (2.13598703592091e+96)
  const r = f * PIO2_BIG;
  const h = Number(r);
  let y0 = h / 2.13598703592091e+96;
  let y1 = Number(r - BigInt(h)) / 2.13598703592091e+96;
  let q = Number(n & 3n);
  if (neg) {
    y0 = -y0;
    y1 = -y1;
    q = -q;
  }
  Y[0] = y0;
  Y[1] = y1;
  return q;
}

function kSin(x: number, y: number, iy: number): number {
  const z = x * x;
  const w = z * z;
  const r = 8.33333333332248946124e-3 + z * (-1.98412698298579493134e-4 + z * 2.75573137070700676789e-6) + z * w * (-2.50507602534068634195e-8 + z * 1.58969099521155010221e-10);
  const v = z * x;
  if (iy === 0) return x + v * (-1.66666666666666324348e-1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * (-1.66666666666666324348e-1));
}

function kCos(x: number, y: number): number {
  const z = x * x;
  let w = z * z;
  const r = z * (4.16666666666666019037e-2 + z * (-1.38888888888741095749e-3 + z * 2.48015872894767294178e-5)) + w * w * (-2.75573143513906633035e-7 + z * (2.08757232129817482790e-9 + z * (-1.13596475577881948265e-11)));
  const hz = 0.5 * z;
  w = 1.0 - hz;
  return w + (((1.0 - w) - hz) + (z * r - x * y));
}

export function sin(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < 0.7853984832763672) { // ~pi/4: no reduction
    if (ax < 1.4901161193847656e-8) return x; // 2^-26
    return kSin(x, 0, 0);
  }
  // Common case inline: one round of the reduction, exactly what remPio2
  // computes when there is no cancellation (otherwise it does the rest).
  // fn = rint(x * 2/pi) (6755399441055744 = 1.5 * 2^52); pi/2 = 1.5707963267341256 + 6.077100506506192e-11.
  const fn = x * 6.36619772367581382433e-1 + 6755399441055744 - 6755399441055744;
  const r = x - fn * 1.57079632673412561417e+0;
  const w = fn * 6.07710050650619224932e-11;
  let y0 = r - w;
  let y1: number;
  let n: number;
  const ay = y0 < 0 ? -y0 : y0;
  if (ax < 1647099 && ay <= 7.85398163397448278999e-1 && ay >= ax * 0.000030517578125) { // 2^-15
    n = fn | 0;
    y1 = (r - y0) - w;
  } else {
    if (!(ax < Infinity)) return x - x;
    n = remPio2(x);
    y0 = Y[0];
    y1 = Y[1];
  }
  // n mod 4 = 0..3: sin(y), cos(y), -sin(y), -cos(y).
  const v = n & 1 ? kCos(y0, y1) : kSin(y0, y1, 1);
  return n & 2 ? -v : v;
}

export function cos(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < 0.7853984832763672) { // ~pi/4: no reduction
    if (ax < 1.0536709282860102e-8) return 1; // 2^-27 * sqrt(2)
    return kCos(x, 0);
  }
  // fn = rint(x * 2/pi) (6755399441055744 = 1.5 * 2^52); pi/2 = 1.5707963267341256 + 6.077100506506192e-11.
  const fn = x * 6.36619772367581382433e-1 + 6755399441055744 - 6755399441055744;
  const r = x - fn * 1.57079632673412561417e+0;
  const w = fn * 6.07710050650619224932e-11;
  let y0 = r - w;
  let y1: number;
  let n: number;
  const ay = y0 < 0 ? -y0 : y0;
  if (ax < 1647099 && ay <= 7.85398163397448278999e-1 && ay >= ax * 0.000030517578125) { // 2^-15
    n = fn | 0;
    y1 = (r - y0) - w;
  } else {
    if (!(ax < Infinity)) return x - x;
    n = remPio2(x);
    y0 = Y[0];
    y1 = Y[1];
  }
  // n mod 4 = 0..3: cos(y), -sin(y), -cos(y), sin(y).
  const v = n & 1 ? kSin(y0, y1, 1) : kCos(y0, y1);
  return (n + 1) & 2 ? -v : v;
}

function kTan(x: number, y: number, odd: number): number {
  const big = (x < 0 ? -x : x) >= 0.6743354797363281; // ~0.6744
  const neg = x < 0;
  if (big) {
    if (neg) {
      x = -x;
      y = -y;
    }
    x = (7.85398163397448278999e-1 - x) + (3.06161699786838301793e-17 - y);
    y = 0.0;
  }
  const z = x * x;
  let w = z * z;
  let r = 1.33333333333201242699e-1 + w * (2.18694882948595424599e-2 + w * (3.59207910759131235356e-3 + w * (5.88041240820264096874e-4 + w * (7.81794442939557092300e-5 + w * (-1.85586374855275456654e-5)))));
  let v = z * (5.39682539762260521377e-2 + w * (8.86323982359930005737e-3 + w * (1.45620945432529025516e-3 + w * (2.46463134818469906812e-4 + w * (7.14072491382608190305e-5 + w * 2.59073051863633712884e-5)))));
  let s = z * x;
  r = y + z * (s * (r + v) + y) + s * 3.33333333333334091986e-1;
  w = x + r;
  if (big) {
    s = 1 - 2 * odd;
    v = s - 2.0 * (x + (r - w * w / (w + s)));
    return neg ? -v : v;
  }
  if (!odd) return w;
  // -1/(x+r) has up to 2 ulp error, so compute it accurately.
  const w0 = clearLow(w);
  v = r - (w0 - x);
  const a = -1.0 / w;
  const a0 = clearLow(a);
  return a0 + a * (1.0 + a0 * w0 + a0 * v);
}

export function tan(x: number): number {
  const ax = x < 0 ? -x : x;
  if (ax < 0.7853984832763672) {
    if (ax < 7.450580596923828e-9) return x;
    return kTan(x, 0, 0);
  }
  if (!(ax < Infinity)) return x - x;
  const n = remPio2(x);
  return kTan(Y[0], Y[1], n & 1);
}

// ---------------------------------------------------------------- atan, atan2

export function atan(x: number): number {
  const neg = x < 0;
  let ax = neg ? -x : x;
  if (!(ax < 73786976294838206464)) {
    if (ax !== ax) return x;
    return neg ? -1.57079632679489655800e+0 : 1.57079632679489655800e+0;
  }
  let id: number;
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return x;
    id = -1;
    ax = x;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      ax = (2.0 * ax - 1.0) / (2.0 + ax);
    } else {
      id = 1;
      ax = (ax - 1.0) / (ax + 1.0);
    }
  } else if (ax < 2.4375) {
    id = 2;
    ax = (ax - 1.5) / (1.0 + 1.5 * ax);
  } else {
    id = 3;
    ax = -1.0 / ax;
  }
  const z = ax * ax;
  const w = z * z;
  const s1 = z * (3.33333333333329318027e-1 + w * (1.42857142725034663711e-1 + w * (9.09088713343650656196e-2 + w * (6.66107313738753120669e-2 + w * (4.97687799461593236017e-2 + w * 1.62858201153657823623e-2)))));
  const s2 = w * (-1.99999999998764832476e-1 + w * (-1.11111104054623557880e-1 + w * (-7.69187620504482999495e-2 + w * (-5.83357013379057348645e-2 + w * (-3.65315727442169155270e-2)))));
  if (id < 0) return ax - ax * (s1 + s2);
  let r: number;
  switch (id) {
    case 0: r = 4.63647609000806093515e-1 - ((ax * (s1 + s2) - 2.26987774529616870924e-17) - ax); break;
    case 1: r = 7.85398163397448278999e-1 - ((ax * (s1 + s2) - 3.06161699786838301793e-17) - ax); break;
    case 2: r = 9.82793723247329054082e-1 - ((ax * (s1 + s2) - 1.39033110312309984516e-17) - ax); break;
    default: r = 1.57079632679489655800e+0 - ((ax * (s1 + s2) - 6.12323399573676603587e-17) - ax); break;
  }
  return neg ? -r : r;
}

/** Angle of (x, y) from the +x axis, in (-pi, pi], with the signs and quadrants of Math.atan2. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (x === 1) return atan(y);
  // 2*sign(x) + sign(y), counting -0 as negative.
  const m = (y < 0 || (y === 0 && 1 / y < 0) ? 1 : 0) | (x < 0 || (x === 0 && 1 / x < 0) ? 2 : 0);
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  if (ay === 0) {
    switch (m) {
      case 0:
      case 1: return y;
      case 2: return 3.1415926535897931160e+0;
      default: return -3.1415926535897931160e+0;
    }
  }
  if (ax === 0) return m & 1 ? -3.1415926535897931160e+0 / 2 : 3.1415926535897931160e+0 / 2;
  if (ax === Infinity) {
    if (ay === Infinity) {
      switch (m) {
        case 0: return 3.1415926535897931160e+0 / 4;
        case 1: return -3.1415926535897931160e+0 / 4;
        case 2: return 3 * 3.1415926535897931160e+0 / 4;
        default: return -3 * 3.1415926535897931160e+0 / 4;
      }
    }
    switch (m) {
      case 0: return 0.0;
      case 1: return -0.0;
      case 2: return 3.1415926535897931160e+0;
      default: return -3.1415926535897931160e+0;
    }
  }
  // |y/x| > 2^64
  if (ay === Infinity || ay > ax * 18446744073709551616) return m & 1 ? -3.1415926535897931160e+0 / 2 : 3.1415926535897931160e+0 / 2;
  let z: number;
  // |y/x| < 2^-64 with x < 0
  if (m & 2 && ax > ay * 18446744073709551616) z = 0;
  else z = atan(ay / ax);
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return 3.1415926535897931160e+0 - (z - 1.2246467991473531772e-16);
    default: return (z - 1.2246467991473531772e-16) - 3.1415926535897931160e+0;
  }
}

// ---------------------------------------------------------------- asin, acos

function rAsin(z: number): number {
  const p = z * (1.66666666666666657415e-1 + z * (-3.25565818622400915405e-1 + z * (2.01212532134862925881e-1 + z * (-4.00555345006794114027e-2 + z * (7.91534994289814532176e-4 + z * 3.47933107596021167570e-5)))));
  const q = 1.0 + z * (-2.40339491173441421878e+0 + z * (2.02094576023350569471e+0 + z * (-6.88283971605453293030e-1 + z * 7.70381505559019352791e-2)));
  return p / q;
}

export function asin(x: number): number {
  const ax = x < 0 ? -x : x;
  if (!(ax < 1)) {
    if (ax === 1) return x * 1.57079632679489655800e+0;
    return NaN;
  }
  if (ax < 0.5) {
    if (ax < 1.4901161193847656e-8) return x;
    return x + x * rAsin(x * x);
  }
  const z = (1 - ax) * 0.5;
  const s = Math.sqrt(z);
  const r = rAsin(z);
  let y: number;
  if (ax >= 0.9749999046325684) { // ~0.975
    y = 1.57079632679489655800e+0 - (2 * (s + s * r) - 6.12323399573676603587e-17);
  } else {
    const f = clearLow(s);
    const c = (z - f * f) / (s + f);
    y = 0.5 * 1.57079632679489655800e+0 - (2 * s * r - (6.12323399573676603587e-17 - 2 * c) - (0.5 * 1.57079632679489655800e+0 - 2 * f));
  }
  return x < 0 ? -y : y;
}

export function acos(x: number): number {
  const ax = x < 0 ? -x : x;
  if (!(ax < 1)) {
    if (ax === 1) return x < 0 ? 2 * 1.57079632679489655800e+0 : 0;
    return NaN;
  }
  if (ax < 0.5) {
    if (ax <= 6.938893903907228e-18) return 1.57079632679489655800e+0;
    return 1.57079632679489655800e+0 - (x - (6.12323399573676603587e-17 - x * rAsin(x * x)));
  }
  if (x < 0) {
    const z = (1.0 + x) * 0.5;
    const s = Math.sqrt(z);
    const w = rAsin(z) * s - 6.12323399573676603587e-17;
    return 2 * (1.57079632679489655800e+0 - (s + w));
  }
  const z = (1.0 - x) * 0.5;
  const s = Math.sqrt(z);
  const df = clearLow(s);
  const c = (z - df * df) / (s + df);
  const w = rAsin(z) * s + c;
  return 2 * (df + w);
}

// ---------------------------------------------------------------- exp, log

export function exp(x: number): number {
  // The algorithm lands 1 ulp high here; keep exp(1) === Math.E.
  if (x === 1) return 2.718281828459045;
  const ax = x < 0 ? -x : x;
  if (ax >= 708.39599609375 || x !== x) { // ~708.4: near over/underflow
    if (x !== x) return x;
    if (x > 709.782712893383973096) return x * 8.98846567431158e+307;
    if (x < -745.13321910194110842) return 0;
  }
  let hi: number;
  let lo: number;
  let k: number;
  if (ax >= 0.3465735912322998) { // > ln2 / 2
    if (ax >= 1.0397205352783203) k = (1.44269504088896338700e+0 * x + (x < 0 ? -0.5 : 0.5)) | 0;
    else k = x < 0 ? -1 : 1;
    hi = x - k * 6.93147180369123816490e-1;
    lo = k * 1.90821492927058770002e-10;
    x = hi - lo;
  } else if (ax >= 3.725293851175593e-9) { // 2^-28
    k = 0;
    hi = x;
    lo = 0;
  } else {
    return 1 + x;
  }
  const xx = x * x;
  const c = x - xx * (1.66666666666666019037e-1 + xx * (-2.77777777770155933842e-3 + xx * (6.61375632143793436117e-5 + xx * (-1.65339022054652515390e-6 + xx * 4.13813679705723846039e-8))));
  const y = 1 + (x * c / (2 - c) - lo + hi);
  if (k === 0) return y;
  return scalbn(y, k);
}

/** Natural logarithm. */
export function log(x: number): number {
  if (!(x > 0)) {
    if (x === 0) return -Infinity;
    return NaN;
  }
  if (x === Infinity) return x;
  if (x === 1) return 0;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    // Subnormal: scale up.
    k -= 54;
    x *= 18014398509481984;
  }
  F[0] = x;
  let hx = U[HI];
  // Reduce x into [sqrt(2)/2, sqrt(2)].
  hx += 0x3ff00000 - 0x3fe6a09e;
  k += (hx >>> 20) - 0x3ff;
  hx = (hx & 0x000fffff) + 0x3fe6a09e;
  U[HI] = hx;
  x = F[0];
  const f = x - 1.0;
  const hfsq = 0.5 * f * f;
  const s = f / (2.0 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (3.999999999940941908e-1 + w * (2.222219843214978396e-1 + w * 1.531383769920937332e-1));
  const t2 = z * (6.666666666666735130e-1 + w * (2.857142874366239149e-1 + w * (1.818357216161805012e-1 + w * 1.479819860511658591e-1)));
  const r = t2 + t1;
  return s * (hfsq + r) + k * 1.90821492927058770002e-10 - hfsq + f + k * 6.93147180369123816490e-1;
}

// ---------------------------------------------------------------- helpers

/** Length of (x, y): Math.sqrt(x*x + y*y), which is exact where Math.hypot is not. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

/** x squared (instead of x ** 2, which is Math.pow). */
export function sq(x: number): number {
  return x * x;
}

/** The functions above as one object, used like Math: DMath.sin(a). */
export const DMath = Object.freeze({ sin, cos, tan, asin, acos, atan, atan2, exp, log, hypot, sq });
