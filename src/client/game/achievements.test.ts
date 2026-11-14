import { describe, expect, it } from 'vitest';
import { Ev, type SimEvent } from '../../shared/sim/events.ts';
import { createCar, type CarState } from '../../shared/sim/car.ts';
import type { World } from '../../shared/sim/world.ts';
import type { Track } from '../../shared/track/types.ts';
import { TRACK_LIST } from '../../shared/track/defs/index.ts';
import { ACHIEVEMENT_IDS, ACHIEVEMENTS, type AchInput, type RaceSummary } from './achievementRules.ts';
import { Achievements, emptyAchState } from './achievements.ts';
import { medalTotals, noteMedalLap, type MedalBook } from './medals.ts';
import { medalTimes } from '../../shared/game/medals.ts';

const fresh = () => new Achievements(ACHIEVEMENTS, emptyAchState(), false);

const summary = (o: Partial<RaceSummary> = {}): RaceSummary => ({
  track: 'greenvalley', league: 'standard', mode: 'quick', cars: 6, place: 4, laps: 3, weapons: false, night: false, kills: 0, damage: 0.3, live: true, ...o,
});
const race = (a: Achievements, o: Partial<RaceSummary> = {}) => a.feed({ kind: 'race', r: summary(o) });
const ev = (kind: number, car: number, other = -1, value = 0, x = 0, z = 0): SimEvent => ({ kind, car, other, value, x, z });

function cars(n: number): CarState[] {
  return Array.from({ length: n }, (_, i) => createCar(i, 0, 0, 0));
}
const world = (c: CarState[]) => ({ cars: c }) as unknown as World;
const track = { length: 1000 } as Track;
const unlocked = (a: Achievements) => Object.keys(a.state.unlocked).sort();

describe('achievement table', () => {
  it('has unique ids, short descriptions and about two dozen entries', () => {
    expect(ACHIEVEMENT_IDS.size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(20);
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(27);
    for (const r of ACHIEVEMENTS) {
      expect(r.desc.length, r.id).toBeLessThanOrEqual(28);
      expect(r.name.length, r.id).toBeLessThanOrEqual(17);
      expect(r.desc).toBe(r.desc.toUpperCase());
    }
  });
});

describe('race rules', () => {
  it('finishing and winning', () => {
    const a = fresh();
    race(a, { place: 5 });
    expect(unlocked(a)).toEqual(['finish']);
    race(a, { place: 1 });
    expect(unlocked(a)).toEqual(['finish', 'win']);
  });

  it('a lone drive is not a win', () => {
    const a = fresh();
    race(a, { cars: 1, place: 1 });
    expect(a.isUnlocked('win')).toBe(false);
  });

  it('counts podiums only in races of four or more, with progress', () => {
    const a = fresh();
    race(a, { cars: 3, place: 2 });
    expect(a.state.progress.podiums ?? 0).toBe(0);
    for (let k = 0; k < 7; k++) race(a, { place: 3 });
    const rule = ACHIEVEMENTS.find((r) => r.id === 'podiums')!;
    expect(a.progress(rule)).toBe(7);
    for (let k = 0; k < 3; k++) race(a, { place: 1 });
    expect(a.isUnlocked('podiums')).toBe(true);
    expect(a.progress(rule)).toBe(10);
  });

  it('needs every league and every track once each', () => {
    const a = fresh();
    race(a, { league: 'standard' });
    race(a, { league: 'standard' });
    race(a, { league: 'super' });
    expect(a.state.progress.allLeagues).toBe(2);
    race(a, { league: 'mega' });
    expect(a.isUnlocked('allLeagues')).toBe(true);
    for (const t of TRACK_LIST) {
      expect(a.isUnlocked('grandTour')).toBe(false);
      race(a, { place: 1, track: t.id });
      race(a, { place: 1, track: t.id });
    }
    expect(a.isUnlocked('grandTour')).toBe(true);
  });

  it('ignores player tracks for the grand tour', () => {
    const a = fresh();
    race(a, { place: 1, track: 'mine-xyz' });
    expect(a.state.progress.grandTour ?? 0).toBe(0);
  });

  it('night, damage and wrecks', () => {
    const a = fresh();
    race(a, { night: true, damage: 0.04, kills: 3 });
    expect(unlocked(a)).toEqual(expect.arrayContaining(['night', 'untouched', 'wrecker']));
    const b = fresh();
    race(b, { damage: 0.05, laps: 1 });
    expect(b.isUnlocked('untouched')).toBe(false);
  });

  it('winning online needs an online race', () => {
    const a = fresh();
    race(a, { place: 1 });
    expect(a.isUnlocked('onlineWin')).toBe(false);
    race(a, { place: 1, mode: 'online', live: false });
    expect(a.isUnlocked('onlineWin')).toBe(true);
  });
});

describe('event and tick rules', () => {
  const me = (c: CarState[]) => c[0];

  it('wrecking cars counts only your own kills', () => {
    const a = fresh();
    const c = cars(4);
    const w = world(c);
    a.feed({ kind: 'event', e: ev(Ev.Wreck, 2, 1), w, me: me(c) });
    expect(a.state.progress.wrecks50 ?? 0).toBe(0);
    a.feed({ kind: 'event', e: ev(Ev.Wreck, 2, 0), w, me: me(c) });
    a.feed({ kind: 'event', e: ev(Ev.Wreck, 0, 0), w, me: me(c) });
    expect(a.state.progress.wrecks50).toBe(1);
    expect(a.isUnlocked('firstBlood')).toBe(true);
  });

  it('a missile hit from far away', () => {
    const a = fresh();
    const c = cars(2);
    a.feed({ kind: 'event', e: ev(Ev.Explosion, 1, 0, 1, 30, 0), w: world(c), me: c[0] });
    a.feed({ kind: 'event', e: ev(Ev.Explosion, 1, 0, 2, 80, 0), w: world(c), me: c[0] });
    expect(a.isUnlocked('longBomb')).toBe(false);
    a.feed({ kind: 'event', e: ev(Ev.Explosion, 1, 0, 1, 70, 0), w: world(c), me: c[0] });
    expect(a.isUnlocked('longBomb')).toBe(true);
  });

  it('homing missile hits and a hit stopped by the shield', () => {
    const a = fresh();
    const c = cars(2);
    for (let k = 0; k < 3; k++) {
      expect(a.isUnlocked('heatSeeker')).toBe(false);
      a.feed({ kind: 'event', e: ev(Ev.Explosion, 1, 0, 4), w: world(c), me: c[0] });
      // A plain missile hit does not count.
      a.feed({ kind: 'event', e: ev(Ev.Explosion, 1, 0, 1), w: world(c), me: c[0] });
    }
    expect(a.isUnlocked('heatSeeker')).toBe(true);
    a.feed({ kind: 'event', e: ev(Ev.ShieldBlock, 1, 0, 1), w: world(c), me: c[0] });
    expect(a.isUnlocked('notToday')).toBe(false);
    a.feed({ kind: 'event', e: ev(Ev.ShieldBlock, 0, 1, 2), w: world(c), me: c[0] });
    expect(a.isUnlocked('notToday')).toBe(true);
  });

  it('a long jump, but not one that ends in a respawn', () => {
    const a = fresh();
    const c = cars(1);
    const w = world(c);
    const tick = () => a.feed({ kind: 'tick', w, me: c[0], track });
    c[0].airborne = 5;
    tick();
    c[0].x = 80;
    tick();
    a.feed({ kind: 'event', e: ev(Ev.Respawn, 0, -1, 3), w, me: c[0] });
    c[0].airborne = 0;
    tick();
    expect(a.isUnlocked('airmail')).toBe(false);
    c[0].x = 0;
    c[0].airborne = 5;
    tick();
    c[0].x = 41;
    c[0].airborne = 0;
    tick();
    expect(a.isUnlocked('airmail')).toBe(true);
  });

  it('a drift held long enough, reset by gripping', () => {
    const a = fresh();
    const c = cars(1);
    const w = world(c);
    c[0].vx = 30;
    c[0].sliding = 1;
    for (let k = 0; k < 200; k++) a.feed({ kind: 'tick', w, me: c[0], track });
    c[0].sliding = 0;
    a.feed({ kind: 'tick', w, me: c[0], track });
    c[0].sliding = 1;
    for (let k = 0; k < 200; k++) a.feed({ kind: 'tick', w, me: c[0], track });
    expect(a.isUnlocked('drift')).toBe(false);
    for (let k = 0; k < 60; k++) a.feed({ kind: 'tick', w, me: c[0], track });
    expect(a.isUnlocked('drift')).toBe(true);
  });

  it('lapping a car that is a lap behind', () => {
    const a = fresh();
    const c = cars(3);
    c[0].place = 1;
    c[1].place = 2;
    c[2].place = 3;
    c[0].raceDist = 900;
    c[2].raceDist = 100;
    a.feed({ kind: 'tick', w: world(c), me: c[0], track });
    expect(a.isUnlocked('lapped')).toBe(false);
    c[0].raceDist = 1200;
    a.feed({ kind: 'tick', w: world(c), me: c[0], track });
    expect(a.isUnlocked('lapped')).toBe(true);
  });

  it('winning after being last, and without firing', () => {
    const a = fresh();
    const c = cars(6);
    const w = world(c);
    a.startRace();
    c[0].place = 6;
    a.feed({ kind: 'event', e: ev(Ev.Lap, 0, 1, 1000), w, me: c[0] });
    a.feed({ kind: 'event', e: ev(Ev.Fire, 0, 1), w, me: c[0] });
    race(a, { place: 1, weapons: true });
    expect(a.isUnlocked('comeback')).toBe(true);
    expect(a.isUnlocked('pacifist')).toBe(false);
    // The next race starts clean.
    a.startRace();
    race(a, { place: 1, weapons: true });
    expect(a.isUnlocked('pacifist')).toBe(true);
  });

  it('does not credit online races for what it could not watch', () => {
    const a = fresh();
    a.startRace();
    race(a, { place: 1, live: false, mode: 'online', weapons: true });
    expect(a.isUnlocked('pacifist')).toBe(false);
    expect(a.isUnlocked('comeback')).toBe(false);
    expect(a.isUnlocked('win')).toBe(true);
  });
});

describe('medal, career and publishing rules', () => {
  it('a medal of each colour and all the golds', () => {
    const a = fresh();
    const book: MedalBook = {};
    const feedMedal = (track: string, league: 'standard' | 'super' | 'mega', medal: 1 | 2 | 3) => {
      const t = medalTimes(track, league)!;
      noteMedalLap(book, track, league, medal === 3 ? t.gold : medal === 2 ? t.silver : t.bronze, false);
      a.feed({ kind: 'medal', track, league, medal, totals: medalTotals(book) });
    };
    feedMedal('greenvalley', 'standard', 1);
    feedMedal('dustbowl', 'standard', 2);
    expect(a.isUnlocked('medalSet')).toBe(false);
    feedMedal('frostring', 'standard', 3);
    expect(a.isUnlocked('medalSet')).toBe(true);
    for (const t of TRACK_LIST) feedMedal(t.id, 'super', 3);
    expect(a.isUnlocked('goldLeague')).toBe(true);
    expect(a.isUnlocked('goldAll')).toBe(false);
    for (const t of TRACK_LIST) {
      feedMedal(t.id, 'standard', 3);
      feedMedal(t.id, 'mega', 3);
    }
    expect(a.isUnlocked('goldAll')).toBe(true);
  });

  it('seasons: promotion, title, defence', () => {
    const a = fresh();
    a.feed({ kind: 'season', outcome: 'stayed' });
    expect(unlocked(a)).toEqual([]);
    a.feed({ kind: 'season', outcome: 'promoted' });
    expect(unlocked(a)).toEqual(['promoted']);
    a.feed({ kind: 'season', outcome: 'champion' });
    expect(a.isUnlocked('champion')).toBe(true);
    expect(a.isUnlocked('defender')).toBe(false);
    a.feed({ kind: 'season', outcome: 'defended' });
    expect(a.isUnlocked('defender')).toBe(true);
  });

  it('publishing', () => {
    const a = fresh();
    a.feed({ kind: 'publish' });
    expect(a.isUnlocked('publish')).toBe(true);
  });
});

describe('unlocking', () => {
  it('reports each unlock once, in order, and keeps the total', () => {
    const a = fresh();
    const seen: string[] = [];
    a.onUnlock = (r) => seen.push(r.id);
    race(a, { place: 1, night: true, weapons: false });
    race(a, { place: 1, night: true, weapons: false });
    expect(seen).toEqual(['finish', 'win', 'night']);
    expect(a.total).toEqual({ done: 3, all: ACHIEVEMENTS.length });
  });

  it('a feed that unlocks two at once returns both', () => {
    const a = fresh();
    const got = a.feed({ kind: 'race', r: summary({ place: 1, weapons: false }) } as AchInput);
    expect(got.map((r) => r.id)).toEqual(['finish', 'win']);
  });
});
