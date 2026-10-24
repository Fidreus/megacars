import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Surface } from '../shared/config/surfaces.ts';
import { canonicalDef, encodeTrack } from '../shared/track/custom.ts';
import type { TrackDef } from '../shared/track/types.ts';
import { TrackChecker } from './trackChecker.ts';
import { TrackStore } from './trackStore.ts';

const RECT: TrackDef = {
  id: 'draft', name: 'Test oval', theme: 'countryside', width: 18, runoff: 5, startAt: 0.5, laps: 3, seed: 7,
  path: [{ x: 300, z: 0, r: 40 }, { x: 300, z: 220, r: 40 }, { x: -300, z: 220, r: 40 }, { x: -300, z: 0, r: 40 }],
  patches: [{ surface: Surface.Gravel, x: 290, z: 210, r: 20, runoff: true }],
};

const dir = mkdtempSync(join(tmpdir(), 'megacars-tracks-'));
const checker = new TrackChecker();
afterAll(() => {
  checker.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('published tracks', () => {
  it('publishes checked tracks, counts likes and plays, sorts and deletes', { timeout: 60_000 }, async () => {
    const store = new TrackStore(dir, checker);
    const a = await store.publish(encodeTrack(RECT), 'anna <b>', store.who('1.2.3.4'));
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.track).toMatchObject({ name: 'TEST OVAL', author: 'ANNA B', theme: 'countryside', likes: 0, plays: 0 });
    expect(a.track.length).toBeGreaterThan(1000);
    // The same track again is the one already there.
    const again = await store.publish(encodeTrack({ ...RECT, id: 'other' }), 'bo', store.who('5.6.7.8'));
    expect(again).toMatchObject({ ok: true, existed: true });
    expect(store.count).toBe(1);

    // Broken, or not a track at all.
    const bad = await store.publish(encodeTrack({ ...RECT, name: 'Bad', path: [{ x: 30, z: 0, r: 80 }, { x: 30, z: 40, r: 80 }, { x: -30, z: 40, r: 80 }] }), 'x', 'w');
    expect(bad.ok).toBe(false);
    expect(await store.publish('nonsense', 'x', 'w')).toMatchObject({ ok: false, status: 400 });

    const b = await store.publish(encodeTrack({ ...RECT, name: 'Second', width: 20 }), 'bo', store.who('5.6.7.8'));
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(store.like(b.track.id, 'p1')).toMatchObject({ ok: true, likes: 1 });
    expect(store.like(b.track.id, 'p1')).toMatchObject({ ok: false, likes: 1 });
    expect(store.like('u-none', 'p1').ok).toBe(false);
    expect(store.play(a.track.id, 'p1')).toBe(true);
    expect(store.play(a.track.id, 'p1')).toBe(true);
    expect(store.play(a.track.id, 'p2')).toBe(true);
    expect(store.get(a.track.id)?.plays).toBe(2);
    expect(store.list('top', 0).tracks.map((t) => t.name)).toEqual(['SECOND', 'TEST OVAL']);
    expect(store.list('played', 0).tracks.map((t) => t.name)).toEqual(['TEST OVAL', 'SECOND']);

    // Kept on disk.
    store.flush();
    const reloaded = new TrackStore(dir, checker);
    expect(reloaded.list('new', 0).total).toBe(2);
    expect(reloaded.get(b.track.id)?.likes).toBe(1);
    expect(reloaded.like(b.track.id, 'p1').ok).toBe(false);
    expect(reloaded.remove(a.track.id)).toBe(true);
    expect(reloaded.remove(a.track.id)).toBe(false);
    expect(reloaded.count).toBe(1);
  });

  it('lets one address publish a few an hour', { timeout: 120_000 }, async () => {
    const store = new TrackStore(mkdtempSync(join(dir, 'limit-')), checker);
    let t = 0;
    store.now = () => t;
    const publish = (k: number) => store.publish(encodeTrack(canonicalDef({ ...RECT, name: `Track ${k}` })), 'me', 'me');
    for (let k = 0; k < 5; k++) expect((await publish(k)).ok).toBe(true);
    expect(await publish(5)).toMatchObject({ ok: false, status: 429 });
    t += 3_600_001;
    expect((await publish(6)).ok).toBe(true);
  });
});
