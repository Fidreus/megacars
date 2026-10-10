// Deterministic random numbers. Simulation code must never use Math.random:
// the generator state lives inside the world so prediction and replay agree.

export interface RngHolder {
  rng: number;
}

/** mulberry32 step: advances `h.rng` and returns a float in [0, 1). */
export function nextRandom(h: RngHolder): number {
  let t = (h.rng = (h.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(h: RngHolder, lo: number, hi: number): number {
  return lo + (hi - lo) * nextRandom(h);
}

/** Stateless hash of up to three integers to a float in [0, 1). */
export function hash3(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Convenience generator for non-simulation code (scenery placement etc). */
export function makeRng(seed: number): () => number {
  const h: RngHolder = { rng: seed | 0 };
  return () => nextRandom(h);
}
