import type { TrackDef } from '../types.ts';

// Simple circuits used by the handling benchmarks in tests.

/** Rounded rectangle with four tight 90° corners (centreline radius 14 m, road 12 m). */
export const BENCH_TIGHT: TrackDef = {
  id: 'bench-tight',
  name: 'Bench Tight',
  theme: 'test',
  width: 12,
  runoff: 3.5,
  startAt: 0.5,
  path: [
    { x: 500, z: 0, r: 14 },
    { x: 500, z: 300, r: 14 },
    { x: 0, z: 300, r: 14 },
    { x: 0, z: 0, r: 14 },
  ],
};

/** Big rounded square with 200 m sweepers. */
export const BENCH_SWEEPER: TrackDef = {
  id: 'bench-sweeper',
  name: 'Bench Sweeper',
  theme: 'test',
  width: 12,
  runoff: 3.5,
  startAt: 0.5,
  path: [
    { x: 700, z: 0, r: 200 },
    { x: 700, z: 700, r: 200 },
    { x: 0, z: 700, r: 200 },
    { x: 0, z: 0, r: 200 },
  ],
};
