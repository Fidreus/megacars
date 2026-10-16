import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { Ev } from '../sim/events.ts';
import { Btn, neutralInput } from '../sim/input.ts';
import { WEAPON } from '../sim/weapons.ts';
import { resetProgress } from '../sim/race.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld, RacePhase } from '../sim/world.ts';
import { getTrack } from './builder.ts';
import { TRACK_LIST } from './defs/index.ts';
import { GREEN_VALLEY } from './defs/greenValley.ts';
import { inPitBox, PIT } from './pit.ts';
import { pointAt } from './builder.ts';

describe('pit lane', () => {
  it('every track has one, behind an island, with room for a few seconds of repairs', () => {
    for (const def of TRACK_LIST) {
      const t = getTrack(def);
      expect(t.pit, def.id).not.toBeNull();
      expect(t.errors, def.id).toEqual([]);
      expect(t.pit!.box1 - t.pit!.box0, def.id).toBeGreaterThan(30);
    }
  });

  it('repairs a parked car every full second', () => {
    const track = getTrack(GREEN_VALLEY);
    const p = track.pit!;
    const w = createWorld(track, 1, 1, { laps: 3, countdownTicks: 0 });
    const car = w.cars[0];
    const inp = neutralInput();
    stepWorld(w, track, [inp], [DEFAULT_TUNING]);
    expect(w.race.phase).toBe(RacePhase.Racing);
    const lat = p.pitOff * p.side;
    Object.assign(car, { x: p.ox + p.nx * lat, z: p.oz + p.nz * lat, heading: Math.atan2(p.tx, -p.tz), vx: 0, vz: 0, damage: 0.55 });
    resetProgress(car, track);
    expect(inPitBox(p, car.x, car.z)).toBe(true);
    let repairs = 0;
    for (let k = 0; k < 60 * 8; k++) {
      stepWorld(w, track, [inp], [DEFAULT_TUNING]);
      for (let e = 0; e < w.events.count; e++) if (w.events.list[e].kind === Ev.Repair) repairs++;
      if (k === 59) expect(car.damage).toBeCloseTo(0.55 - PIT.repair, 6);
    }
    expect(car.damage).toBe(0);
    expect(repairs).toBe(Math.ceil(0.55 / PIT.repair));
    expect(car.respawns).toBe(0);
    expect(inPitBox(p, car.x, car.z)).toBe(true);
  });

  it('a battered computer car takes the pit lane on every track and comes out repaired', () => {
    for (const def of TRACK_LIST) {
      const track = getTrack(def);
      const p = track.pit!;
      const w = createWorld(track, 1, 1, { laps: 3, countdownTicks: 0 });
      stepWorld(w, track, [], [DEFAULT_TUNING]);
      const car = w.cars[0];
      car.aiDriven = 1;
      // On the centreline well before the lane, at racing speed.
      const at = { x: 0, z: 0, heading: 0 };
      pointAt(track, track.length + p.a - 120, at);
      Object.assign(car, { x: at.x, z: at.z, heading: at.heading, vx: Math.sin(at.heading) * 30, vz: -Math.cos(at.heading) * 30, damage: 0.7 });
      resetProgress(car, track);
      let boxTicks = 0;
      let hardHits = 0;
      for (let k = 0; k < 60 * 30 && !(car.trackS > p.b + 30 && car.trackS < track.length / 2); k++) {
        stepWorld(w, track, [], [DEFAULT_TUNING]);
        if (inPitBox(p, car.x, car.z)) boxTicks++;
        for (let e = 0; e < w.events.count; e++) if (w.events.list[e].kind === Ev.WallHit && w.events.list[e].value > 6) hardHits++;
      }
      expect(boxTicks, def.id).toBeGreaterThan(120);
      expect(car.damage, def.id).toBeLessThan(0.6);
      expect(car.respawns, def.id).toBe(0);
      expect(hardHits, def.id).toBe(0);
    }
  });

  it('no weapons in the pit lane', () => {
    const track = getTrack(GREEN_VALLEY);
    const p = track.pit!;
    const w = createWorld(track, 2, 1, { laps: 3, countdownTicks: 0, weapons: true });
    w.race.startTick = -WEAPON.startGrace;
    const lat = p.pitOff * p.side;
    const heading = Math.atan2(p.tx, -p.tz);
    // Two cars in the box, one 20 m behind the other, firing at it.
    for (const [c, u] of [[w.cars[0], -10], [w.cars[1], 10]] as const) {
      Object.assign(c, { x: p.ox + p.tx * u + p.nx * lat, z: p.oz + p.tz * u + p.nz * lat, heading, vx: 0, vz: 0 });
      resetProgress(c, track);
    }
    const fire = { ...neutralInput(), buttons: Btn.FireFront | Btn.FireRear };
    const before = w.cars[0].missiles + w.cars[0].mines;
    for (let k = 0; k < 30; k++) stepWorld(w, track, [fire, neutralInput()], [DEFAULT_TUNING]);
    expect(w.cars[0].missiles + w.cars[0].mines).toBe(before);
    expect(w.shots.some((s) => s.kind !== 0)).toBe(false);
    expect(w.cars[1].damage).toBe(0);
  });
});

