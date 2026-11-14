import { describe, expect, it } from 'vitest';
import { DMath } from './dmath.ts';
import { bitsOf, dmathTable } from './dmathTable.ts';
import { makeRng } from './rng.ts';

const F = new Float64Array(1);
const I = new BigInt64Array(F.buffer);

/** Distance between two doubles in units in the last place. */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || (a !== a && b !== b)) return 0;
  if (a === b) return 0;
  F[0] = a;
  const x = I[0] < 0n ? -(I[0] & 0x7fffffffffffffffn) : I[0];
  F[0] = b;
  const y = I[0] < 0n ? -(I[0] & 0x7fffffffffffffffn) : I[0];
  return Number(x > y ? x - y : y - x);
}

const rnd = makeRng(20261114);
const uniform = (lo: number, hi: number) => () => lo + (hi - lo) * rnd();
/** Magnitudes spread evenly over the exponents, both signs. */
const spread = (lo: number, hi: number) => () => (rnd() < 0.5 ? -1 : 1) * 10 ** (lo + (hi - lo) * rnd());
const nearHalfPi = () => {
  const k = Math.floor(rnd() * 2000) - 1000;
  return k * (Math.PI / 2) + (rnd() - 0.5) * 10 ** (-15 * rnd());
};

function worst(f: (x: number) => number, g: (x: number) => number, gen: () => number, n = 20000): { ulps: number; at: number } {
  let w = { ulps: 0, at: 0 };
  for (let i = 0; i < n; i++) {
    const x = gen();
    const u = ulps(f(x), g(x));
    if (u > w.ulps) w = { ulps: u, at: x };
  }
  return w;
}

describe('DMath accuracy against the built-in functions', () => {
  const cases: [string, (x: number) => number, (x: number) => number, Record<string, () => number>][] = [
    ['sin', DMath.sin, Math.sin, { race: uniform(-7, 7), wide: uniform(-1e4, 1e4), tiny: spread(-320, -5), huge: spread(5, 308), nearHalfPi }],
    ['cos', DMath.cos, Math.cos, { race: uniform(-7, 7), wide: uniform(-1e4, 1e4), tiny: spread(-320, -5), huge: spread(5, 308), nearHalfPi }],
    ['tan', DMath.tan, Math.tan, { race: uniform(-7, 7), wide: uniform(-1e4, 1e4), tiny: spread(-320, -5), huge: spread(5, 308), nearHalfPi }],
    ['atan', DMath.atan, Math.atan, { unit: uniform(-3, 3), tiny: spread(-320, -1), huge: spread(-1, 308) }],
    ['asin', DMath.asin, Math.asin, { unit: uniform(-1, 1), edge: () => (rnd() < 0.5 ? -1 : 1) * (1 - 10 ** (-16 * rnd())), tiny: spread(-320, -1) }],
    ['acos', DMath.acos, Math.acos, { unit: uniform(-1, 1), edge: () => (rnd() < 0.5 ? -1 : 1) * (1 - 10 ** (-16 * rnd())), tiny: spread(-320, -1) }],
    ['exp', DMath.exp, Math.exp, { race: uniform(-10, 10), wide: uniform(-750, 710), tiny: spread(-320, -1) }],
    ['log', DMath.log, Math.log, { wide: () => 10 ** (-320 + 628 * rnd()), nearOne: () => 1 + (rnd() - 0.5) * 10 ** (-16 * rnd()) }],
  ];
  for (const [name, f, g, gens] of cases) {
    for (const [range, gen] of Object.entries(gens)) {
      it(`${name} (${range}) is within 1 ulp`, () => {
        const w = worst(f, g, gen);
        expect(w.ulps, `${name}(${w.at})`).toBeLessThanOrEqual(1);
      });
    }
  }

  it('atan2 is within 1 ulp in every quadrant and at every scale', () => {
    for (const gen of [uniform(-10, 10), spread(-300, 300)]) {
      let w = 0;
      for (let i = 0; i < 20000; i++) {
        const y = gen();
        const x = gen();
        w = Math.max(w, ulps(DMath.atan2(y, x), Math.atan2(y, x)));
      }
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('hypot is the exact square root of the sum of squares', () => {
    const gen = uniform(-1e3, 1e3);
    for (let i = 0; i < 1000; i++) {
      const x = gen();
      const y = gen();
      expect(DMath.hypot(x, y)).toBe(Math.sqrt(x * x + y * y));
      expect(ulps(DMath.hypot(x, y), Math.hypot(x, y))).toBeLessThanOrEqual(2);
    }
  });
});

describe('DMath identities and special values', () => {
  it('keeps zeros, ones and signs', () => {
    expect(Object.is(DMath.sin(0), 0)).toBe(true);
    expect(Object.is(DMath.sin(-0), -0)).toBe(true);
    expect(Object.is(DMath.tan(-0), -0)).toBe(true);
    expect(Object.is(DMath.atan(-0), -0)).toBe(true);
    expect(DMath.cos(0)).toBe(1);
    expect(DMath.cos(-0)).toBe(1);
    expect(DMath.exp(0)).toBe(1);
    expect(DMath.exp(-0)).toBe(1);
    expect(DMath.exp(1)).toBe(Math.E);
    expect(DMath.log(1)).toBe(0);
    expect(DMath.acos(1)).toBe(0);
    expect(DMath.acos(-1)).toBe(Math.PI);
    expect(DMath.asin(1)).toBe(Math.PI / 2);
    expect(DMath.atan(1)).toBe(Math.PI / 4);
    expect(DMath.sin(Math.PI / 2)).toBe(1);
    expect(DMath.cos(Math.PI)).toBe(-1);
  });

  it('sin and cos stay within [-1, 1] and are odd and even', () => {
    const gen = uniform(-50, 50);
    for (let i = 0; i < 20000; i++) {
      const x = gen();
      const s = DMath.sin(x);
      const c = DMath.cos(x);
      expect(Math.abs(s)).toBeLessThanOrEqual(1);
      expect(Math.abs(c)).toBeLessThanOrEqual(1);
      expect(DMath.sin(-x)).toBe(-s);
      expect(DMath.cos(-x)).toBe(c);
      expect(DMath.tan(-x)).toBe(-DMath.tan(x));
      expect(Math.abs(s * s + c * c - 1)).toBeLessThan(4e-16);
    }
  });

  it('atan2 has the quadrants and signs of Math.atan2', () => {
    const pi = Math.PI;
    const table: [number, number, number][] = [
      [0, 1, 0], [-0, 1, -0], [0, -1, pi], [-0, -1, -pi], [0, 0, 0], [-0, 0, -0], [0, -0, pi], [-0, -0, -pi],
      [1, 0, pi / 2], [-1, 0, -pi / 2], [1, -0, pi / 2], [-1, -0, -pi / 2],
      [1, 1, pi / 4], [-1, 1, -pi / 4], [1, -1, (3 * pi) / 4], [-1, -1, (-3 * pi) / 4],
      [Infinity, Infinity, pi / 4], [-Infinity, Infinity, -pi / 4], [Infinity, -Infinity, (3 * pi) / 4], [-Infinity, -Infinity, (-3 * pi) / 4],
      [1, Infinity, 0], [-1, Infinity, -0], [1, -Infinity, pi], [-1, -Infinity, -pi], [Infinity, 1, pi / 2], [-Infinity, 1, -pi / 2],
      [1e-300, -1, pi], [-1e-300, -1, -pi], [1e300, 1e-300, pi / 2],
    ];
    for (const [y, x, want] of table) {
      expect(Object.is(DMath.atan2(y, x), want), `atan2(${y}, ${x})`).toBe(true);
      expect(Object.is(DMath.atan2(y, x), Math.atan2(y, x)), `atan2(${y}, ${x}) vs Math`).toBe(true);
    }
    const gen = uniform(-5, 5);
    for (let i = 0; i < 5000; i++) {
      const y = gen();
      const x = gen();
      const a = DMath.atan2(y, x);
      expect(Math.sign(a)).toBe(Math.sign(y));
      expect(Math.abs(a) > pi / 2).toBe(x < 0);
      expect(Math.abs(a)).toBeLessThanOrEqual(pi);
    }
  });

  it('handles NaN, infinities, overflow and underflow', () => {
    for (const f of [DMath.sin, DMath.cos, DMath.tan]) {
      expect(f(NaN)).toBeNaN();
      expect(f(Infinity)).toBeNaN();
      expect(f(-Infinity)).toBeNaN();
    }
    expect(DMath.atan2(NaN, 1)).toBeNaN();
    expect(DMath.atan2(1, NaN)).toBeNaN();
    expect(DMath.asin(1.5)).toBeNaN();
    expect(DMath.acos(-1.5)).toBeNaN();
    expect(DMath.atan(Infinity)).toBe(Math.PI / 2);
    expect(DMath.atan(-Infinity)).toBe(-Math.PI / 2);
    expect(DMath.exp(Infinity)).toBe(Infinity);
    expect(DMath.exp(-Infinity)).toBe(0);
    expect(DMath.exp(710)).toBe(Infinity);
    expect(DMath.exp(-746)).toBe(0);
    expect(DMath.exp(-745)).toBe(5e-324);
    expect(DMath.exp(NaN)).toBeNaN();
    expect(DMath.log(0)).toBe(-Infinity);
    expect(DMath.log(-1)).toBeNaN();
    expect(DMath.log(Infinity)).toBe(Infinity);
    expect(DMath.log(5e-324)).toBe(Math.log(5e-324));
  });
});

describe('DMath results are pinned to the bit', () => {
  // If one of these changes, every race changes with it: bump SIM_VERSION and
  // regenerate this table from dmathTable().
  const EXPECTED = [
  'sin(0000000000000000) = 0000000000000000',
  'sin(8000000000000000) = 8000000000000000',
  'sin(01a56e1fc2f8f359) = 01a56e1fc2f8f359',
  'sin(0000000000000001) = 0000000000000001',
  'sin(3e112e0be826d695) = 3e112e0be826d695',
  'sin(be112e0be826d695) = be112e0be826d695',
  'sin(3e40000000000000) = 3e40000000000000',
  'sin(3fb999999999999a) = 3fb98eaecb8bcb2c',
  'sin(bfe0000000000000) = bfdeaee8744b05f0',
  'sin(3fe594af4f0d844d) = 3fe3fb5210a73cf2',
  'sin(3fe921fb54442d18) = 3fe6a09e667f3bcc',
  'sin(3ff0000000000000) = 3feaed548f090cee',
  'sin(bff0000000000000) = bfeaed548f090cee',
  'sin(4000000000000000) = 3fed18f6ead1b446',
  'sin(4008000000000000) = 3fc210386db6d55b',
  'sin(c008000000000000) = bfc210386db6d55b',
  'sin(3ff921fb54442d18) = 3ff0000000000000',
  'sin(bff921fb54442d18) = bff0000000000000',
  'sin(3ff921fb54442d19) = 3ff0000000000000',
  'sin(3ff921fb54442d17) = 3ff0000000000000',
  'sin(400921fb54442d18) = 3ca1a62633145c07',
  'sin(c00921fb54442d18) = bca1a62633145c07',
  'sin(400921fb54442d19) = bcb72cece675d1fd',
  'sin(4012d97c7f3321d2) = bff0000000000000',
  'sin(401921fb54442d18) = bcb1a62633145c07',
  'sin(c01921fb54442d18) = 3cb1a62633145c07',
  'sin(401f6a7a2955385e) = 3ff0000000000000',
  'sin(4063a28c59d5433b) = 3cd1b19140c0c0d5',
  'sin(401e000000000000) = 3fee041886fcae30',
  'sin(c028800000000000) = 3fd3e96127b2fac8',
  'sin(408f400000000000) = 3fea75cc150a206b',
  'sin(40fe240c9fbe76c9) = bfeff50e60ab53f9',
  'sin(412e848000000000) = bfd6664b2568d867',
  'sin(c12e848000000000) = 3fd6664b2568d867',
  'sin(41386a0000000000) = bfe153286220550f',
  'sin(4139f0a000000000) = 3fe2468b4fe40abc',
  'sin(41cdcd6500000000) = 3fe1778cae83c69b',
  'sin(430c6bf526340000) = 3feb76f88136ceba',
  'sin(4480f0cf064dd592) = bfeb453ab76bf397',
  'sin(c480f0cf064dd592) = 3feb453ab76bf397',
  'sin(54b249ad2594c37d) = bfd85c5e5b929359',
  'sin(7fefdcf158adbb99) = bfe01f13714f8c2a',
  'cos(0000000000000000) = 3ff0000000000000',
  'cos(8000000000000000) = 3ff0000000000000',
  'cos(01a56e1fc2f8f359) = 3ff0000000000000',
  'cos(0000000000000001) = 3ff0000000000000',
  'cos(3e112e0be826d695) = 3ff0000000000000',
  'cos(be112e0be826d695) = 3ff0000000000000',
  'cos(3e40000000000000) = 3ff0000000000000',
  'cos(3fb999999999999a) = 3fefd712f9a817c1',
  'cos(bfe0000000000000) = 3fec1528065b7d50',
  'cos(3fe594af4f0d844d) = 3fe8fe9f26eae490',
  'cos(3fe921fb54442d18) = 3fe6a09e667f3bcd',
  'cos(3ff0000000000000) = 3fe14a280fb5068c',
  'cos(bff0000000000000) = 3fe14a280fb5068c',
  'cos(4000000000000000) = bfdaa22657537205',
  'cos(4008000000000000) = bfefae04be85e5d2',
  'cos(c008000000000000) = bfefae04be85e5d2',
  'cos(3ff921fb54442d18) = 3c91a62633145c07',
  'cos(bff921fb54442d18) = 3c91a62633145c07',
  'cos(3ff921fb54442d19) = bca72cece675d1fd',
  'cos(3ff921fb54442d17) = 3cb469898cc51702',
  'cos(400921fb54442d18) = bff0000000000000',
  'cos(c00921fb54442d18) = bff0000000000000',
  'cos(400921fb54442d19) = bff0000000000000',
  'cos(4012d97c7f3321d2) = bcaa79394c9e8a0a',
  'cos(401921fb54442d18) = 3ff0000000000000',
  'cos(c01921fb54442d18) = 3ff0000000000000',
  'cos(401f6a7a2955385e) = 3cb60fafbfd97309',
  'cos(4063a28c59d5433b) = 3ff0000000000000',
  'cos(401e000000000000) = 3fd62f45e66f5c2f',
  'cos(c028800000000000) = 3fee69701f67477a',
  'cos(408f400000000000) = 3fe1ff026793f1bc',
  'cos(40fe240c9fbe76c9) = 3faa74d27c41b22a',
  'cos(412e848000000000) = 3fedf9df9906d32c',
  'cos(c12e848000000000) = 3fedf9df9906d32c',
  'cos(41386a0000000000) = 3feae78ad815d7c4',
  'cos(4139f0a000000000) = bfea44969d28fe08',
  'cos(41cdcd6500000000) = 3feacff8c7364234',
  'cos(430c6bf526340000) = bfe06c154609d33e',
  'cos(4480f0cf064dd592) = 3fe0be2cef01c8f4',
  'cos(c480f0cf064dd592) = 3fe0be2cef01c8f4',
  'cos(54b249ad2594c37d) = 3fed9757496841f5',
  'cos(7fefdcf158adbb99) = bfeba4728a45d204',
  'tan(0000000000000000) = 0000000000000000',
  'tan(8000000000000000) = 8000000000000000',
  'tan(01a56e1fc2f8f359) = 01a56e1fc2f8f359',
  'tan(0000000000000001) = 0000000000000001',
  'tan(3e112e0be826d695) = 3e112e0be826d695',
  'tan(be112e0be826d695) = be112e0be826d695',
  'tan(3e40000000000000) = 3e40000000000000',
  'tan(3fb999999999999a) = 3fb9af8877430b80',
  'tan(bfe0000000000000) = bfe17b4f5bf3474a',
  'tan(3fe594af4f0d844d) = 3fe995054ea00c37',
  'tan(3fe921fb54442d18) = 3fefffffffffffff',
  'tan(3ff0000000000000) = 3ff8eb245cbee3a6',
  'tan(bff0000000000000) = bff8eb245cbee3a6',
  'tan(4000000000000000) = c0017af62e0950f8',
  'tan(4008000000000000) = bfc23ef71254b86f',
  'tan(c008000000000000) = 3fc23ef71254b86f',
  'tan(3ff921fb54442d18) = 434d02967c31cdb5',
  'tan(bff921fb54442d18) = c34d02967c31cdb5',
  'tan(3ff921fb54442d19) = c33617a15494767a',
  'tan(3ff921fb54442d17) = 4329153d9443ed0b',
  'tan(400921fb54442d18) = bca1a62633145c07',
  'tan(c00921fb54442d18) = 3ca1a62633145c07',
  'tan(400921fb54442d19) = 3cb72cece675d1fd',
  'tan(4012d97c7f3321d2) = 4333570efd768923',
  'tan(401921fb54442d18) = bcb1a62633145c07',
  'tan(c01921fb54442d18) = 3cb1a62633145c07',
  'tan(401f6a7a2955385e) = 432735453027d7c4',
  'tan(4063a28c59d5433b) = 3cd1b19140c0c0d5',
  'tan(401e000000000000) = 4005a5ea99227d5b',
  'tan(c028800000000000) = 3fd4f391a2f659d1',
  'tan(408f400000000000) = 3ff786729f34311a',
  'tan(40fe240c9fbe76c9) = c03353a85fe8d6d5',
  'tan(412e848000000000) = bfd7e9768ab734c0',
  'tan(c12e848000000000) = 3fd7e9768ab734c0',
  'tan(41386a0000000000) = bfe49b262592cb36',
  'tan(4139f0a000000000) = bfe6437a03a84f0a',
  'tan(41cdcd6500000000) = 3fe4d8b249e3dba7',
  'tan(430c6bf526340000) = bffac23600a95be4',
  'tan(4480f0cf064dd592) = bffa0f79c1b6b258',
  'tan(c480f0cf064dd592) = 3ffa0f79c1b6b258',
  'tan(54b249ad2594c37d) = bfda5807d6f76f7d',
  'tan(7fefdcf158adbb99) = 3fe2a9ae4154b5dd',
  'atan(0000000000000000) = 0000000000000000',
  'atan(8000000000000000) = 8000000000000000',
  'atan(39b4484bfeebc2a0) = 39b4484bfeebc2a0',
  'atan(3fd3333333333333) = 3fd2a73a661eaf06',
  'atan(3fdc000000000000) = 3fda64eec3cc23fd',
  'atan(3fe0000000000000) = 3fddac670561bb4f',
  'atan(bfe6147ae147ae14) = bfe353d41c5dfe67',
  'atan(3ff0000000000000) = 3fe921fb54442d18',
  'atan(3ff3000000000000) = 3febde70ed439fe7',
  'atan(3ff8000000000000) = 3fef730bd281f69b',
  'atan(4003800000000000) = 3ff2e75728833a54',
  'atan(c008000000000000) = bff3fc176b7a8560',
  'atan(4024000000000000) = 3ff789bd2c160054',
  'atan(4202a05f20000000) = 3ff921fb543d4de0',
  'atan(46293e5939a08cea) = 3ff921fb54442d18',
  'atan(fe37e43c8800759c) = bff921fb54442d18',
  'atan(7ff0000000000000) = 3ff921fb54442d18',
  'atan(fff0000000000000) = bff921fb54442d18',
  'asin(0000000000000000) = 0000000000000000',
  'asin(8000000000000000) = 8000000000000000',
  'asin(3bc79ca10c924223) = 3bc79ca10c924223',
  'asin(3fd0000000000000) = 3fd02be9ce0b87cd',
  'asin(bfdffe5c91d14e3c) = bfe0c06011bb06b4',
  'asin(3fe0000000000000) = 3fe0c152382d7366',
  'asin(3fe6666666666666) = 3fe8d00e692afd95',
  'asin(bfeccccccccccccd) = bff1ea93705fa172',
  'asin(3fef333333333333) = 3ff58c2b5ce0c3e5',
  'asin(3fefffeb074a771d) = 3ff90fa9f3695aa5',
  'asin(3ff0000000000000) = 3ff921fb54442d18',
  'asin(bff0000000000000) = bff921fb54442d18',
  'acos(0000000000000000) = 3ff921fb54442d18',
  'acos(8000000000000000) = 3ff921fb54442d18',
  'acos(3bc79ca10c924223) = 3ff921fb54442d18',
  'acos(3fd0000000000000) = 3ff51700e0c14b25',
  'acos(bfdffe5c91d14e3c) = 4000c115ae90d839',
  'acos(3fe0000000000000) = 3ff0c152382d7366',
  'acos(3fe6666666666666) = 3fe973e83f5d5c9b',
  'acos(bfeccccccccccccd) = 400586476251e745',
  'acos(3fef333333333333) = 3fccae7fbb1b499a',
  'acos(3fefffeb074a771d) = 3f725160dad27316',
  'acos(3ff0000000000000) = 0000000000000000',
  'acos(bff0000000000000) = 400921fb54442d18',
  'exp(0000000000000000) = 3ff0000000000000',
  'exp(8000000000000000) = 3ff0000000000000',
  'exp(3bc79ca10c924223) = 3ff0000000000000',
  'exp(bddb7cdfd9d7bdbb) = 3feffffffff24190',
  'exp(3fb999999999999a) = 3ff1aec7b35a00d4',
  'exp(3fd62d0e56041893) = 3ff6a03146cf6ead',
  'exp(bfe0000000000000) = 3fe368b2fc6f960a',
  'exp(3fe0a305532617c2) = 3ffae8e575d2b7d8',
  'exp(3ff0000000000000) = 4005bf0a8b145769',
  'exp(bff0000000000000) = 3fd78b56362cef38',
  'exp(4004000000000000) = 40285d6fd931e0bb',
  'exp(4024000000000000) = 40d5829dcf950560',
  'exp(c034000000000000) = 3e21b48655f37267',
  'exp(4059000000000000) = 48f3494a9b171bf5',
  'exp(c059000000000000) = 36ea8c1f14e2af5d',
  'exp(4085e00000000000) = 7f0d945df4f8ec8e',
  'exp(40862d999999999a) = 7fed75ae7a50ee14',
  'exp(40862e51eb851eb8) = 7ff0000000000000',
  'exp(c086200000000000) = 0017c8ab2288c9ab',
  'exp(c087200000000000) = 0000000000000055',
  'exp(c08749999999999a) = 0000000000000000',
  'log(3ff0000000000000) = 0000000000000000',
  'log(4000000000000000) = 3fe62e42fefa39ef',
  'log(3fe0000000000000) = bfe62e42fefa39ef',
  'log(000012688b70e62b) = c0864e69394d9508',
  'log(01a56e1fc2f8f359) = c085963447f87fb5',
  'log(3fb999999999999a) = c0026bb1bbb55515',
  'log(3fe6a09e65dc27df) = bfd62e4300c77ae8',
  'log(3ff6a09e65dc27df) = 3fd62e42fd2cf8f6',
  'log(4024000000000000) = 40026bb1bbb55516',
  'log(7e37e43c8800759c) = 4085963447f87fb5',
  'log(0000000000000000) = fff0000000000000',
  'log(7ff0000000000000) = 7ff0000000000000',
  'atan2(0000000000000000, 0000000000000000) = 0000000000000000',
  'atan2(8000000000000000, 0000000000000000) = 8000000000000000',
  'atan2(0000000000000000, 8000000000000000) = 400921fb54442d18',
  'atan2(8000000000000000, 8000000000000000) = c00921fb54442d18',
  'atan2(3ff0000000000000, 0000000000000000) = 3ff921fb54442d18',
  'atan2(bff0000000000000, 0000000000000000) = bff921fb54442d18',
  'atan2(0000000000000000, 3ff0000000000000) = 0000000000000000',
  'atan2(0000000000000000, bff0000000000000) = 400921fb54442d18',
  'atan2(3ff0000000000000, 3ff0000000000000) = 3fe921fb54442d18',
  'atan2(bff0000000000000, 3ff0000000000000) = bfe921fb54442d18',
  'atan2(3ff0000000000000, bff0000000000000) = 4002d97c7f3321d2',
  'atan2(bff0000000000000, bff0000000000000) = c002d97c7f3321d2',
  'atan2(4008000000000000, 4010000000000000) = 3fe4978fa3269ee1',
  'atan2(c008000000000000, c010000000000000) = c003fc176b7a8560',
  'atan2(01a56e1fc2f8f359, bff0000000000000) = 400921fb54442d18',
  'atan2(81a56e1fc2f8f359, bff0000000000000) = c00921fb54442d18',
  'atan2(7e37e43c8800759c, 3ddb7cdfd9d7bdbb) = 3ff921fb54442d18',
  'atan2(7ff0000000000000, 7ff0000000000000) = 3fe921fb54442d18',
  'atan2(fff0000000000000, 7ff0000000000000) = bfe921fb54442d18',
  'atan2(7ff0000000000000, fff0000000000000) = 4002d97c7f3321d2',
  'atan2(4014000000000000, 7ff0000000000000) = 0000000000000000',
  'atan2(4014000000000000, fff0000000000000) = 400921fb54442d18',
  'atan2(3fc999999999999a, 3ff0000000000000) = 3fc94441f8f7260c',
  'atan2(4000000000000000, 3fe0000000000000) = 3ff5368c951e9cfd',
  'atan2(3fe3333333333333, bfe999999999999a) = 4003fc176b7a8560',
  'atan2(c05ed9999999999a, 404c59999999999a) = bff23dca892550b2',
  'hypot(0000000000000000, 0000000000000000) = 0000000000000000',
  'hypot(8000000000000000, 0000000000000000) = 0000000000000000',
  'hypot(0000000000000000, 8000000000000000) = 0000000000000000',
  'hypot(8000000000000000, 8000000000000000) = 0000000000000000',
  'hypot(3ff0000000000000, 0000000000000000) = 3ff0000000000000',
  'hypot(bff0000000000000, 0000000000000000) = 3ff0000000000000',
  'hypot(0000000000000000, 3ff0000000000000) = 3ff0000000000000',
  'hypot(0000000000000000, bff0000000000000) = 3ff0000000000000',
  'hypot(3ff0000000000000, 3ff0000000000000) = 3ff6a09e667f3bcd',
  'hypot(bff0000000000000, 3ff0000000000000) = 3ff6a09e667f3bcd',
  'hypot(3ff0000000000000, bff0000000000000) = 3ff6a09e667f3bcd',
  'hypot(bff0000000000000, bff0000000000000) = 3ff6a09e667f3bcd',
  'hypot(4008000000000000, 4010000000000000) = 4014000000000000',
  'hypot(c008000000000000, c010000000000000) = 4014000000000000',
  'hypot(01a56e1fc2f8f359, bff0000000000000) = 3ff0000000000000',
  'hypot(81a56e1fc2f8f359, bff0000000000000) = 3ff0000000000000',
  'hypot(7e37e43c8800759c, 3ddb7cdfd9d7bdbb) = 7ff0000000000000',
  'hypot(7ff0000000000000, 7ff0000000000000) = 7ff0000000000000',
  'hypot(fff0000000000000, 7ff0000000000000) = 7ff0000000000000',
  'hypot(7ff0000000000000, fff0000000000000) = 7ff0000000000000',
  'hypot(4014000000000000, 7ff0000000000000) = 7ff0000000000000',
  'hypot(4014000000000000, fff0000000000000) = 7ff0000000000000',
  'hypot(3fc999999999999a, 3ff0000000000000) = 3ff0511de5a8265f',
  'hypot(4000000000000000, 3fe0000000000000) = 40007e0f66afed07',
  'hypot(3fe3333333333333, bfe999999999999a) = 3ff0000000000000',
  'hypot(c05ed9999999999a, 404c59999999999a) = 4060f9b207ec9c00',
  ];

  it('gives exactly the recorded bits for the fixed inputs', () => {
    const rows = dmathTable();
    expect(rows.length).toBe(EXPECTED.length);
    for (let i = 0; i < rows.length; i++) expect(rows[i]).toBe(EXPECTED[i]);
  });

  it('formats bits as written', () => {
    expect(bitsOf(1)).toBe('3ff0000000000000');
    expect(bitsOf(-0)).toBe('8000000000000000');
  });
});
