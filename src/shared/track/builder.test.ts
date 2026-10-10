import { describe, expect, it } from 'vitest';
import { Surface } from '../config/surfaces.ts';
import { buildTrack, surfaceAt, distanceToCentreline } from './builder.ts';
import { validateTrack } from './validate.ts';
import { GREEN_VALLEY } from './defs/greenValley.ts';
import { BENCH_SWEEPER, BENCH_TIGHT } from './defs/bench.ts';

describe('track builder', () => {
  const track = buildTrack(GREEN_VALLEY);

  it('builds Green Valley without validation errors', () => {
    expect(validateTrack(track)).toEqual([]);
    expect(track.length).toBeGreaterThan(1800);
    expect(track.length).toBeLessThan(2600);
    expect(track.grid).toHaveLength(8);
    expect(track.walls.count).toBeGreaterThan(50);
  });

  it('has the expected surfaces', () => {
    expect(surfaceAt(track, 100, 0)).toBe(Surface.Asphalt); // main straight
    expect(surfaceAt(track, 100, 40)).toBe(Surface.Grass); // outside the walls
    expect(surfaceAt(track, -154, 335)).toBe(Surface.Ice);
    // Gravel through corner B, including run-off.
    const i = track.n - 1;
    expect(distanceToCentreline(track, track.px[i], track.pz[i])).toBeLessThan(0.6);
  });

  it('keeps the racing line inside the road', () => {
    for (let i = 0; i < track.n; i++) {
      expect(Math.abs(track.line.off[i])).toBeLessThanOrEqual(track.hw[i] - 1.15 + 1e-9);
    }
  });

  it('builds the benchmark tracks', () => {
    expect(validateTrack(buildTrack(BENCH_TIGHT))).toEqual([]);
    expect(validateTrack(buildTrack(BENCH_SWEEPER))).toEqual([]);
  });

  it('rejects corners too tight for the barriers', () => {
    const bad = buildTrack({ ...BENCH_TIGHT, id: 'bad', path: BENCH_TIGHT.path.map((p) => ({ ...p, r: 6 })) });
    expect(validateTrack(bad).length).toBeGreaterThan(0);
  });
});
