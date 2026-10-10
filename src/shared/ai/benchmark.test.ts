// The handling contract: a controlled drift must beat brake-and-grip through
// a tight 90° corner from top speed, while grip stays at least as fast on a
// fast sweeper. Re-run after every tuning change.

import { describe, expect, it } from 'vitest';
import { BENCH_SWEEPER, BENCH_TIGHT } from '../track/defs/bench.ts';
import { runSegment, type SegmentResult } from './benchmark.ts';
import { AiMode } from './driver.ts';

// Corner 0 of BENCH_TIGHT starts 236 m after the start line and is 22 m long.
const TIGHT = { def: BENCH_TIGHT, s0: 136, s1: 236 + 22 + 100 };
// Corner 0 of BENCH_SWEEPER starts 150 m after the start line and is 314 m long.
const SWEEP = { def: BENCH_SWEEPER, s0: 50, s1: 150 + 314 + 100 };

describe('handling benchmark', () => {
  it('drift beats grip by at least 8% through a tight 90° corner', () => {
    const grip = runSegment(TIGHT.def, AiMode.Grip, TIGHT.s0, TIGHT.s1, 45);
    const drift = runSegment(TIGHT.def, AiMode.Drift, TIGHT.s0, TIGHT.s1, 45);
    console.log('tight 90°  grip', fmt(grip), '\n           drift', fmt(drift), `\n           gain ${((1 - drift.time / grip.time) * 100).toFixed(1)}%`);
    expect(drift.wallHits).toBe(0);
    expect(grip.wallHits).toBe(0);
    expect(drift.time).toBeLessThanOrEqual(grip.time * 0.92);
  });

  it('grip is at least as fast as drifting on a fast sweeper', () => {
    const grip = runSegment(SWEEP.def, AiMode.Grip, SWEEP.s0, SWEEP.s1, 45);
    const drift = runSegment(SWEEP.def, AiMode.Drift, SWEEP.s0, SWEEP.s1, 45);
    console.log('sweeper    grip', fmt(grip), '\n           drift', fmt(drift));
    expect(grip.wallHits).toBe(0);
    expect(grip.time).toBeLessThanOrEqual(drift.time * 1.005);
  });
});

function fmt(r: SegmentResult): string {
  return `t=${r.time.toFixed(2)}s min=${r.minSpeed.toFixed(1)} exit=${r.exitSpeed.toFixed(1)} slip=${r.maxSlipDeg.toFixed(1)}° walls=${r.wallHits}`;
}
