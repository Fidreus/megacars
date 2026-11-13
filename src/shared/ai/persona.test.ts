import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { headingOf } from '../math/angle.ts';
import { AI_NAMES, AI_SKILL } from '../game/roster.ts';
import { createRaceWorld } from '../game/raceSetup.ts';
import { setPersona } from '../game/personaSetup.ts';
import type { RaceSpec } from '../net/protocol.ts';
import { buildTrack, sampleIndexAt } from '../track/builder.ts';
import { getTrack } from '../track/builder.ts';
import { BENCH_TIGHT } from '../track/defs/bench.ts';
import { GREEN_VALLEY } from '../track/defs/greenValley.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld, RacePhase } from '../sim/world.ts';
import { effectiveSkill, NEUTRAL, PERSONAS, personaIndex, personaOf } from './persona.ts';
import { expect as expectSense, notice, reactionTicks, Sense } from './reaction.ts';

describe('personalities', () => {
  it('every named driver has one, with a short line about them', () => {
    expect(PERSONAS).toHaveLength(AI_NAMES.length);
    for (const p of PERSONAS) {
      expect(p.blurb.length).toBeLessThanOrEqual(34);
      expect(p.blurb).toBe(p.blurb.toUpperCase());
      expect(p.tag.length).toBeLessThanOrEqual(14);
    }
    expect(personaIndex('DIESEL DAN')).toBe(AI_NAMES.indexOf('DIESEL DAN'));
    expect(personaIndex('YOU')).toBe(-1);
    expect(personaOf(-1)).toBe(NEUTRAL);
  });

  it('pace offsets spread the field around the difficulty, not off it', () => {
    const paces = PERSONAS.map((p) => p.pace);
    const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
    // Slightly above zero: it pays for the habits that cost time (early braking,
    // slow starts, a wandering line). scripts/personaLaps.ts measures the field.
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(Math.max(...paces) - Math.min(...paces)).toBeGreaterThan(0.04);
    for (const p of paces) expect(Math.abs(p)).toBeLessThan(0.05);
  });

  it('a wild card changes pace from lap to lap, the same way every time', () => {
    const lou = personaOf(personaIndex('LUCKY LOU'));
    const w = createWorld(getTrack(GREEN_VALLEY), 1, 1);
    const car = w.cars[0];
    car.aiSkill = 0.86;
    const laps = [1, 2, 3, 4, 5].map((lap) => {
      car.lap = lap;
      return effectiveSkill(car, lou);
    });
    expect(new Set(laps).size).toBeGreaterThan(1);
    car.lap = 3;
    expect(effectiveSkill(car, lou)).toBe(laps[2]);
    for (const s of laps) expect(Math.abs(s - 0.86 - lou.pace)).toBeLessThanOrEqual(lou.erratic);
  });

  it('come from the race spec: computer names only, turbo lovers carry one more', () => {
    const spec: RaceSpec = {
      id: 1, track: 'greenvalley', laps: 1, seed: 1, countdownTicks: 1, weapons: true,
      entrants: [
        { name: 'NITRO NINA', color: '#fff', playerId: -1, skill: AI_SKILL[1] },
        { name: 'ACE', color: '#fff', playerId: -1, skill: AI_SKILL[1], rival: 0 },
        { name: 'BLITZ', color: '#fff', playerId: 0, skill: AI_SKILL[1] },
      ],
    };
    const { world } = createRaceWorld(spec);
    const [nina, ace, person] = world.cars;
    expect(nina.aiPersona).toBe(personaIndex('NITRO NINA'));
    expect(nina.turbos).toBe(ace.turbos + 1);
    expect(ace.aiFoe).toBe(2);
    expect(nina.aiFoe).toBe(-1);
    // A person named like a computer driver gets no personality (also if the computer takes over).
    expect(person.aiPersona).toBe(-1);
  });

  it('the fastest personality beats the slowest over a race', () => {
    const track = getTrack(GREEN_VALLEY);
    const time = (name: string) => {
      const w = createWorld(track, 1, 3, { laps: 1, countdownTicks: 1 });
      const c = w.cars[0];
      c.aiDriven = 1;
      c.aiSkill = AI_SKILL[1];
      setPersona(c, personaIndex(name));
      while (w.race.phase !== RacePhase.Finished && w.tick < 60 * 120) stepWorld(w, track, [], [DEFAULT_TUNING]);
      expect(c.finished).toBe(1);
      return c.finishTick;
    };
    const ace = time('ACE');
    const sparky = time('SPARKY');
    expect(ace).toBeLessThan(sparky);
    // About 3 % apart: a spread, not a different class.
    expect(sparky / ace).toBeLessThan(1.05);
  });
});

describe('reaction time', () => {
  const car = createWorld(getTrack(GREEN_VALLEY), 1, 1).cars[0];
  const range = (skill: number) => {
    car.aiSkill = skill;
    const t = Array.from({ length: 400 }, (_, i) => reactionTicks(car, NEUTRAL, Sense.Traffic, i) / 60);
    return [Math.min(...t), Math.max(...t), t.reduce((a, b) => a + b, 0) / t.length];
  };

  it('is slower on easier difficulties and varies from moment to moment', () => {
    const [easyLo, easyHi] = range(AI_SKILL[0]);
    const [medLo, medHi] = range(AI_SKILL[1]);
    const [hardLo, hardHi, hardMean] = range(AI_SKILL[2]);
    expect(easyLo).toBeGreaterThanOrEqual(0.24);
    expect(easyHi).toBeLessThanOrEqual(0.36);
    expect(medLo).toBeGreaterThanOrEqual(0.14);
    expect(medHi).toBeLessThanOrEqual(0.26);
    expect(hardLo).toBeGreaterThanOrEqual(0.07);
    expect(hardHi).toBeLessThanOrEqual(0.16);
    expect(hardHi - hardLo).toBeGreaterThan(0.03);
    expect(hardMean).toBeLessThan(medLo);
  });

  it('a new situation is acted on after the delay, forgotten when it goes, skipped when expected', () => {
    car.aiSkill = AI_SKILL[1];
    car.aiAware = 0;
    car.aiReact = 0;
    const delay = reactionTicks(car, NEUTRAL, Sense.Target, 100);
    let tick = 100;
    let seen = 0;
    while (!notice(car, NEUTRAL, Sense.Target, true, tick)) {
      tick++;
      seen++;
    }
    expect(seen).toBe(delay - 1);
    expect(notice(car, NEUTRAL, Sense.Target, true, tick + 1)).toBe(true);
    // Other senses are untouched.
    expect(notice(car, NEUTRAL, Sense.Tail, true, tick)).toBe(false);
    expect(notice(car, NEUTRAL, Sense.Target, false, tick)).toBe(false);
    expect(notice(car, NEUTRAL, Sense.Target, true, tick + 2)).toBe(false);
    expectSense(car, Sense.Go);
    expect(notice(car, NEUTRAL, Sense.Go, true, tick)).toBe(true);
  });

  it('nervous drivers react later than the cool ones', () => {
    car.aiSkill = AI_SKILL[1];
    const mean = (name: string) => {
      const p = personaOf(personaIndex(name));
      let sum = 0;
      for (let i = 0; i < 300; i++) sum += reactionTicks(car, p, Sense.Slide, i);
      return sum / 300;
    };
    expect(mean('SPARKY')).toBeGreaterThan(mean('ACE') + 2);
  });
});

describe('straights', () => {
  it('a car knocked sideways on a straight catches it and drives on straight', () => {
    const track = buildTrack(BENCH_TIGHT);
    const w = createWorld(track, 1, 1);
    const car = w.cars[0];
    // Middle of the 470 m back straight, at speed, 20° sideways.
    const i = sampleIndexAt(track, 60);
    const j = (i + 1) % track.n;
    const h = headingOf(track.line.x[j] - track.line.x[i], track.line.z[j] - track.line.z[i]);
    Object.assign(car, { x: track.line.x[i], z: track.line.z[i], trackIdx: i, trackS: track.s[i], aiDriven: 1, aiSkill: AI_SKILL[1] });
    car.heading = h + 0.35;
    car.vx = Math.sin(h) * 35;
    car.vz = -Math.cos(h) * 35;
    car.sliding = 1;
    let gripTick = -1;
    for (let k = 0; k < 120; k++) {
      stepWorld(w, track, [], [DEFAULT_TUNING]);
      if (!car.sliding && gripTick < 0) gripTick = k;
    }
    expect(gripTick).toBeGreaterThan(0);
    expect(gripTick).toBeLessThan(60);
    // And it stays gripping for the rest of the straight.
    expect(car.sliding).toBe(0);
  });
});
