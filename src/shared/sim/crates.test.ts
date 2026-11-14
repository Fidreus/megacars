import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { applySnapshot, encodeSnapshot, peekSnapshot } from '../net/snapshot.ts';
import { getTrack } from '../track/builder.ts';
import { TRACK_LIST } from '../track/defs/index.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { inPitArea, onPitLane, sampleU } from '../track/pit.ts';
import { createCar } from './car.ts';
import { CATCH_UP } from './catchUp.ts';
import {
  CRATE, CRATE_AI, CRATE_CAPS, CRATE_ITEMS, CrateItem, crateLean, crateRowCount, rollCrate,
} from './crates.ts';
import { Ev } from './events.ts';
import { neutralInput } from './input.ts';
import { resetProgress } from './race.ts';
import { stepWorld } from './step.ts';
import { createWorld } from './world.ts';
import { simulateRace } from '../game/raceSim.ts';

describe('crate placement', () => {
  it('every track gets rows of two or three, more on longer laps', () => {
    for (const def of TRACK_LIST) {
      const t = getTrack(def);
      const rows = new Set(t.crates.map((c) => c.row));
      expect(rows.size, def.id).toBeGreaterThanOrEqual(1);
      expect(rows.size, def.id).toBeLessThanOrEqual(crateRowCount(t.length));
      if (!def.lapScale && !def.id.startsWith('bench')) expect(rows.size, def.id).toBeGreaterThanOrEqual(3);
      for (const r of rows) {
        const n = t.crates.filter((c) => c.row === r).length;
        expect(n === 2 || n === 3, def.id).toBe(true);
      }
    }
  });

  it('never in the pit lane, on the grid, a ramp, its landing, a bridge, a pad or a tight corner', () => {
    for (const def of TRACK_LIST) {
      const t = getTrack(def);
      for (const c of t.crates) {
        const where = `${def.id} s=${c.s.toFixed(0)}`;
        expect(inPitArea(t.pit, c.x, c.z), where).toBe(false);
        expect(onPitLane(t.pit, c.x, c.z), where).toBe(false);
        // Grid and start line: off the start straight.
        const u = sampleU(t, c.i);
        expect(u < -60 || u > 40, where).toBe(true);
        if (t.pit) expect(u < t.pit.a - 10 || u > t.pit.b + 10, where).toBe(true);
        // On the road, clear of the barrier.
        expect(Math.abs(c.lat), where).toBeLessThanOrEqual(t.hw[c.i] - 2);
        expect(t.deck[c.i], where).toBe(0);
        expect(c.y, where).toBe(0);
        const fwd = (a: number, b: number) => ((b - a) % t.length + t.length) % t.length;
        for (const r of t.ramps) expect(fwd(r.s0 - 20, c.s) > r.s1 - r.s0 + 20 + 60, where).toBe(true);
        for (const p of t.boosts) expect(fwd(p - 10, c.s) > CATCH_UP.length + 20, where).toBe(true);
        for (const b of t.bridges) {
          expect(Math.min(fwd(b.s, c.s), fwd(c.s, b.s)), where).toBeGreaterThan(b.span + b.ramp);
          expect(Math.min(fwd(b.sLower, c.s), fwd(c.s, b.sLower)), where).toBeGreaterThan(20);
        }
        for (let d = 0; d <= 40; d++) expect(Math.abs(t.curv[(c.i + d) % t.n]), where).toBeLessThanOrEqual(1 / CRATE.tightR);
      }
    }
  });

  it('spreads the rows round the lap', () => {
    for (const def of TRACK_LIST) {
      const t = getTrack(def);
      const s = [...new Set(t.crates.map((c) => c.s))];
      for (let a = 0; a < s.length; a++) {
        for (let b = a + 1; b < s.length; b++) {
          const d = Math.abs(s[a] - s[b]);
          expect(Math.min(d, t.length - d), def.id).toBeGreaterThan(Math.min(150, t.length / (crateRowCount(t.length) * 2.5)));
        }
      }
    }
  });
});

describe('crate contents', () => {
  const car = (over: Partial<ReturnType<typeof createCar>> = {}) => Object.assign(createCar(0, 0, 0, 0), over);

  it('are the same for the same seed, crate and tick', () => {
    for (let tick = 0; tick < 200; tick++) {
      expect(rollCrate(7, 3, tick, car({ place: 4 }), 8)).toBe(rollCrate(7, 3, tick, car({ place: 4 }), 8));
    }
    const kinds = new Set<number>();
    for (let tick = 0; tick < 400; tick++) kinds.add(rollCrate(7, 3, tick, car({ place: 4, damage: 0.5 }), 8)!.item);
    expect(kinds.size).toBe(CRATE_ITEMS.length);
  });

  it('never fill past the shop caps; a full car gets something else, or nothing', () => {
    const full = car({ missiles: CRATE_CAPS.missiles, place: 8 });
    for (let tick = 0; tick < 500; tick++) expect(rollCrate(1, 0, tick, full, 8)?.item).not.toBe(CrateItem.Missiles);
    const almost = car({ missiles: CRATE_CAPS.missiles - 1, mines: CRATE_CAPS.mines, turbos: CRATE_CAPS.turbos });
    const c = rollCrate(1, 0, 0, almost, 8)!;
    expect(c.item).toBe(CrateItem.Missiles);
    expect(c.give(almost)).toBe(1);
    expect(almost.missiles).toBe(CRATE_CAPS.missiles);
    expect(rollCrate(1, 0, 0, car({ missiles: 12, mines: 8, turbos: 6, damage: 0 }), 8)).toBeNull();
  });

  it('give the leader more mines and the back more turbo and repair, mildly', () => {
    const count = (place: number) => {
      const n: Record<number, number> = {};
      for (let tick = 0; tick < 4000; tick++) {
        const it = rollCrate(5, 2, tick, car({ place, damage: 0.5 }), 8)!.item;
        n[it] = (n[it] ?? 0) + 1;
      }
      return n;
    };
    const lead = count(1);
    const last = count(8);
    expect(lead[CrateItem.Mines]).toBeGreaterThan(last[CrateItem.Mines] * 1.8);
    expect(last[CrateItem.Turbo]).toBeGreaterThan(lead[CrateItem.Turbo] * 1.5);
    expect(last[CrateItem.Repair]).toBeGreaterThan(lead[CrateItem.Repair] * 1.5);
    // Mild: the leader still gets every kind.
    for (const c of CRATE_ITEMS) expect(lead[c.item]).toBeGreaterThan(200);
  });

  it('repair mends some damage', () => {
    const c = car({ damage: 0.5, missiles: 12, mines: 8, turbos: 6 });
    const r = rollCrate(1, 0, 0, c, 8)!;
    expect(r.item).toBe(CrateItem.Repair);
    expect(r.give(c)).toBe(30);
    expect(c.damage).toBeCloseTo(0.2);
  });
});

describe('crates in a race', () => {
  /** A one-car world with the car parked on crate `k`. */
  function onCrate(weapons: boolean, k = 0) {
    const track = getTrack(GREEN_VALLEY);
    const w = createWorld(track, 1, 3, { laps: 3, countdownTicks: 0, weapons });
    const c = w.cars[0];
    const sp = track.crates[k];
    const i = sp.i;
    Object.assign(c, { x: sp.x, z: sp.z, heading: Math.atan2(track.tx[i], -track.tz[i]) });
    resetProgress(c, track);
    return { track, w, c };
  }

  it('a car driving through takes the crate, which comes back after the respawn time', () => {
    const { track, w, c } = onCrate(true);
    const before = c.missiles + c.mines + c.turbos;
    stepWorld(w, track, [neutralInput()], [DEFAULT_TUNING]);
    const ev = w.events.list.slice(0, w.events.count).filter((e) => e.kind === Ev.CratePickup);
    expect(ev.length).toBe(1);
    expect(ev[0].car).toBe(0);
    expect(c.missiles + c.mines + c.turbos).toBeGreaterThan(before);
    expect(w.crates[0]).toBe(CRATE.respawnTicks);
    // Move the car away and wait.
    c.x += 200;
    let back = -1;
    for (let k = 1; k <= CRATE.respawnTicks + 5 && back < 0; k++) {
      stepWorld(w, track, [neutralInput()], [DEFAULT_TUNING]);
      for (let e = 0; e < w.events.count; e++) if (w.events.list[e].kind === Ev.CrateBack && w.events.list[e].other === 0) back = k;
    }
    expect(back).toBe(CRATE.respawnTicks);
    expect(w.crates[0]).toBe(0);
  });

  it('no crates with weapons off', () => {
    const { track, w } = onCrate(false);
    stepWorld(w, track, [neutralInput()], [DEFAULT_TUNING]);
    expect(w.crates.every((c) => c === 0)).toBe(true);
    for (let e = 0; e < w.events.count; e++) expect(w.events.list[e].kind).not.toBe(Ev.CratePickup);
  });

  it('a car full of everything leaves the crate standing', () => {
    const { track, w, c } = onCrate(true);
    Object.assign(c, { missiles: 12, mines: 8, turbos: 6, damage: 0 });
    stepWorld(w, track, [neutralInput()], [DEFAULT_TUNING]);
    expect(w.crates[0]).toBe(0);
  });

  it('survive a snapshot round trip', () => {
    const { track, w } = onCrate(true, 1);
    stepWorld(w, track, [neutralInput()], [DEFAULT_TUNING]);
    for (let i = 0; i < 100; i++) stepWorld(w, track, [neutralInput()], [DEFAULT_TUNING]);
    expect(w.crates[1]).toBe(CRATE.respawnTicks - 100);
    const data = encodeSnapshot(w, [neutralInput()], { lead: 0, lastInputTick: 0 });
    expect(peekSnapshot(data)).not.toBeNull();
    const b = createWorld(track, 1, 3, { laps: 3, countdownTicks: 0, weapons: true });
    expect(applySnapshot(data, b, [])).toBe(w.tick);
    expect(b.crates).toEqual(w.crates);
    // A cut-off snapshot is refused.
    expect(peekSnapshot(data.subarray(0, data.length - 1))).toBeNull();
  });

  it('computer drivers lean toward a crate near their line, never far off it', () => {
    const track = getTrack(GREEN_VALLEY);
    const crates = track.crates.map(() => 0);
    const c = createCar(0, 0, 0, 0);
    let leaned = 0;
    for (let s = 0; s < track.length; s += 3) {
      const i = Math.floor((s / track.length) * track.n);
      Object.assign(c, { x: track.px[i], z: track.pz[i] });
      resetProgress(c, track);
      const lean = crateLean(c, track, crates);
      expect(Math.abs(lean)).toBeLessThanOrEqual(CRATE_AI.maxShift);
      if (lean !== 0) leaned++;
    }
    expect(leaned).toBeGreaterThan(0);
    // Nothing to gain: no lean.
    Object.assign(c, { missiles: 12, mines: 8, turbos: 6, damage: 0 });
    for (const sp of track.crates) {
      Object.assign(c, { x: track.px[(sp.i - 30 + track.n) % track.n], z: track.pz[(sp.i - 30 + track.n) % track.n] });
      resetProgress(c, track);
      expect(crateLean(c, track, crates)).toBe(0);
    }
  });

  it('computer drivers take crates and still all finish', () => {
    const r = simulateRace(GREEN_VALLEY, 2, { laps: 2, weapons: true });
    expect(r.finished).toBe(r.cars);
    expect(r.pickups).toBeGreaterThan(8);
  });
});
