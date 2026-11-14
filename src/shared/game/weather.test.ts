import { describe, expect, it } from 'vitest';
import type { RaceSpec } from '../net/protocol.ts';
import { applySnapshot, encodeSnapshot } from '../net/snapshot.ts';
import { neutralInput } from '../sim/input.ts';
import { stepWorld } from '../sim/step.ts';
import { rainAt, wetnessAt } from '../sim/weather.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { MANHATTAN_SPRINT } from '../track/defs/manhattanSprint.ts';
import { createRaceWorld } from './raceSetup.ts';
import { simulateRace } from './raceSim.ts';
import { specProblem } from './records.ts';
import { pickWeather, seasonWeather, weatherField, weatherOf } from './weather.ts';

function spec(weather?: RaceSpec['weather'], seed = 77): RaceSpec {
  const entrants = [0, 1, 2].map((k) => ({ name: `AI${k}`, color: '#fff', playerId: -1, skill: 0.9 }));
  entrants.push({ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 });
  return { id: 0, track: 'greenvalley', laps: 3, seed, countdownTicks: 210, weapons: true, entrants, ...(weather ? { weather } : {}) };
}

describe('race weather', () => {
  it('comes from the spec, dry when absent', () => {
    expect(weatherOf(spec())).toBe('dry');
    expect(weatherOf(spec('rain'))).toBe('rain');
    expect(weatherOf({ weather: 'hail' as never })).toBe('dry');
    expect(weatherField('dry')).toEqual({});
    expect(createRaceWorld(spec()).world.weather).toBeUndefined();
    const { world } = createRaceWorld(spec('changing'));
    expect(world.weather?.kind).toBe('changing');
  });

  it('RANDOM gives all three, the same for the same seed', () => {
    const seen = new Set<string>();
    for (let s = 0; s < 200; s++) {
      seen.add(pickWeather('random', s));
      expect(pickWeather('random', s)).toBe(pickWeather('random', s));
    }
    expect(seen).toEqual(new Set(['dry', 'rain', 'changing']));
    expect(pickWeather('rain', 5)).toBe('rain');
    expect(pickWeather(undefined, 5)).toBe('dry');
  });

  it('seasons are mostly dry, about one race in four wet or changing', () => {
    let wet = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (seasonWeather(1000 + (i >> 3), i & 7) !== 'dry') wet++;
    expect(wet / n).toBeGreaterThan(0.2);
    expect(wet / n).toBeLessThan(0.3);
  });

  it('wet races do not count for lap records', () => {
    expect(specProblem(spec())).toBeNull();
    expect(specProblem(spec('dry'))).toBeNull();
    expect(specProblem(spec('rain'))).toBe('dry races only');
    expect(specProblem(spec('changing'))).toBe('dry races only');
  });

  it('a changing race on the real track changes while it is being raced', () => {
    const r = simulateRace(GREEN_VALLEY, 1, { laps: 3, cars: 2 });
    for (let seed = 1; seed <= 30; seed++) {
      const s = spec('changing', seed);
      const { world } = createRaceWorld(s);
      const end = s.countdownTicks + Math.round(r.winnerSeconds * 60);
      let lo = 1;
      let hi = 0;
      for (let t = s.countdownTicks; t <= end; t += 30) {
        lo = Math.min(lo, rainAt(world.weather, t));
        hi = Math.max(hi, rainAt(world.weather, t));
      }
      expect(hi - lo, `seed ${seed}`).toBeGreaterThan(0.9);
    }
  });

  it('survives a rewind: a world restored from a snapshot drives on exactly the same', () => {
    const s = spec('changing', 3);
    const a = createRaceWorld(s);
    const inputs = a.world.cars.map(() => neutralInput());
    // Run until the weather is on the move.
    const plan = a.world.weather!;
    const busy = plan.rainOn > 0 ? plan.rainOn + 300 : plan.rainOff + 300;
    while (a.world.tick < busy) stepWorld(a.world, a.track, inputs, a.tunings);
    const snap = encodeSnapshot(a.world, inputs, { lead: 0, lastInputTick: 0 });
    const b = createRaceWorld(s);
    applySnapshot(snap, b.world, b.world.cars.map(() => neutralInput()));
    expect(wetnessAt(b.world.weather, b.world.tick)).toBe(wetnessAt(a.world.weather, a.world.tick));
    for (let n = 0; n < 600; n++) {
      stepWorld(a.world, a.track, inputs, a.tunings);
      stepWorld(b.world, b.track, inputs, b.tunings);
    }
    expect(b.world.cars.map((c) => [c.x, c.z, c.vx, c.vz])).toEqual(a.world.cars.map((c) => [c.x, c.z, c.vx, c.vz]));
  });
});

describe('simulated wet races', () => {
  for (const weather of ['rain', 'changing'] as const) {
    it(`every car finishes in the ${weather}, with and without weapons`, () => {
      for (const weapons of [false, true]) {
        const r = simulateRace(GREEN_VALLEY, 2, { laps: 2, weapons, weather });
        expect(r.finished, `${weather} weapons=${weapons}: ${JSON.stringify(r)}`).toBe(r.cars);
      }
    });
  }

  it('the rain costs time', () => {
    const dry = simulateRace(MANHATTAN_SPRINT, 3, { laps: 3 });
    const wet = simulateRace(MANHATTAN_SPRINT, 3, { laps: 3, weather: 'rain' });
    expect(wet.finished).toBe(wet.cars);
    expect(wet.bestLapSeconds).toBeGreaterThan(dry.bestLapSeconds);
  });
});
