import { describe, expect, it } from 'vitest';
import { Surface } from '../config/surfaces.ts';
import { canonicalDef, checkTrackDef, cleanTrackName, decodeTrack, encodeTrack, LIMITS } from './custom.ts';
import { registerTrack, trackDef, trackName, TRACK_LIST } from './defs/index.ts';
import { getTrack } from './builder.ts';
import type { TrackDef } from './types.ts';

/** A plain rectangle with a long start straight: valid, with a pit and pads. */
const RECT: TrackDef = {
  id: 'draft', name: 'Test oval', theme: 'countryside', width: 18, runoff: 5, startAt: 0.5, laps: 3, seed: 7,
  path: [
    { x: 300, z: 0, r: 40 }, { x: 300, z: 220, r: 40 }, { x: -300, z: 220, r: 40 }, { x: -300, z: 0, r: 40 },
  ],
  patches: [{ surface: Surface.Gravel, x: 290, z: 210, r: 20, runoff: true }],
  ramps: [{ x: 0, z: 220, length: 10, height: 1.4 }],
};

describe('player tracks', () => {
  it('round-trips through a share code', () => {
    const code = encodeTrack(RECT);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThan(600);
    const back = decodeTrack(code)!;
    expect(back).toEqual(canonicalDef(RECT));
    expect(encodeTrack(back)).toBe(code);
  });

  it('round-trips every built-in track (without bridges)', () => {
    for (const def of TRACK_LIST) {
      const c = canonicalDef(def);
      expect(decodeTrack(encodeTrack(def)), def.id).toEqual(c);
      expect(c.id.startsWith('u-')).toBe(true);
      expect(c.bridges).toBeUndefined();
    }
  });

  it('gives the same content the same id, and different content another', () => {
    const a = canonicalDef(RECT);
    expect(canonicalDef({ ...RECT, id: 'other' }).id).toBe(a.id);
    // Below the rounding: the same track.
    expect(canonicalDef({ ...RECT, width: 18.1 }).id).toBe(a.id);
    expect(canonicalDef({ ...RECT, width: 19 }).id).not.toBe(a.id);
    expect(canonicalDef({ ...RECT, name: 'Other' }).id).not.toBe(a.id);
  });

  it('keeps within the limits', () => {
    const big = canonicalDef({
      ...RECT,
      name: 'a very long name that goes on and on <script>',
      width: 99, runoff: -3, startAt: 2, theme: 'moon',
      path: Array.from({ length: 80 }, (_, i) => ({ x: 9999 * Math.cos(i), z: 9999 * Math.sin(i), r: 1e6 })),
      patches: Array.from({ length: 40 }, () => ({ surface: 99 as never, x: 0, z: 0, r: 999 })),
    });
    expect(big.path.length).toBe(LIMITS.points[1]);
    expect(big.patches!.length).toBe(LIMITS.patches);
    expect(big.width).toBe(LIMITS.width[1]);
    expect(big.runoff).toBe(LIMITS.runoff[0]);
    expect(big.startAt).toBe(0.95);
    expect(big.theme).toBe('countryside');
    expect(big.name.length).toBeLessThanOrEqual(LIMITS.name);
    expect(big.name).not.toMatch(/[<>]/);
    for (const p of big.path) expect(Math.abs(p.x)).toBeLessThanOrEqual(LIMITS.extent);
  });

  it('rejects codes that are not tracks', () => {
    expect(decodeTrack('')).toBeNull();
    expect(decodeTrack('not a code!')).toBeNull();
    expect(decodeTrack('a'.repeat(5000))).toBeNull();
    expect(decodeTrack('W1sxXV0')).toBeNull();
    expect(cleanTrackName('  héllo  world ')).toBe('HLLO WORLD');
  });

  it('checks a track: fine, missing a pit, broken', () => {
    const ok = checkTrackDef(canonicalDef(RECT));
    expect(ok.errors).toEqual([]);
    expect(ok.missing).toEqual([]);
    // A short start straight: drivable, but no pit lane.
    const small = checkTrackDef(canonicalDef({ ...RECT, path: [{ x: 70, z: 0, r: 20 }, { x: 70, z: 300, r: 20 }, { x: -70, z: 300, r: 20 }, { x: -70, z: 0, r: 20 }] }));
    expect(small.errors).toEqual([]);
    expect(small.missing.some((m) => m.includes('pit'))).toBe(true);
    // Corners that don't fit.
    const bad = checkTrackDef(canonicalDef({ ...RECT, path: [{ x: 30, z: 0, r: 80 }, { x: 30, z: 40, r: 80 }, { x: -30, z: 40, r: 80 }] }));
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('registers player tracks for racing and evicts old builds', () => {
    const def = canonicalDef(RECT);
    registerTrack(def);
    expect(trackDef(def.id)).toBe(def);
    expect(trackName(def.id)).toBe('TEST OVAL');
    expect(getTrack(def).def).toBe(def);
    // Many more player tracks built: the cache keeps a few, rebuilding the old one on demand.
    for (let k = 0; k < 8; k++) getTrack(canonicalDef({ ...RECT, seed: 100 + k }));
    expect(getTrack(def).def).toBe(def);
  });
});
