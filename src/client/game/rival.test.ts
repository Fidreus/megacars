import { beforeEach, describe, expect, it } from 'vitest';
import { personaIndex, personaOf } from '../../shared/ai/persona.ts';
import { humanDrivers, leader, nextRaceSpec, standingsRows, type Championship } from './championship.ts';
import { endSeason, loadCareer, newCareer, saveCareer } from './career.ts';
import { duelResult, duelText, pickRival, recordDuel, rivalCar, rivalOf, setRival } from './rival.ts';

/** Points for a finished season: the computer drivers 100, 90, ...; the player at `place`. */
function finishSeason(c: Championship, place: number): void {
  const others = c.drivers.filter((d) => d.player < 0);
  others.forEach((d, i) => (d.profile.points = 100 - i * 10));
  humanDrivers(c)[0].profile.points = place === 1 ? 200 : 100 - (place - 2) * 10 - 5;
  c.race = c.tracks.length;
}

const pace = (name: string) => personaOf(personaIndex(name)).pace;

// A tiny localStorage for the save tests.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
});

describe('career rival', () => {
  it('a first season pits you against one of the quickest drivers in the field', () => {
    const c = newCareer();
    const r = rivalOf(c.cup)!;
    expect(r.player).toBe(-1);
    const quicker = c.cup.drivers.filter((d) => d.player < 0 && pace(d.name) > pace(r.name));
    expect(quicker.length).toBeLessThan(3);
    expect(c.cup.duel).toEqual({ ahead: 0, behind: 0 });
  });

  it('another season in the division: whoever finished just ahead of you', () => {
    const c = newCareer();
    finishSeason(c.cup, 5);
    const ahead = [...c.cup.drivers].sort((a, b) => b.profile.points - a.profile.points)[3].name;
    expect(endSeason(c).outcome).toBe('stayed');
    expect(rivalOf(c.cup)!.name).toBe(ahead);
    // Brought into the new field if the draw left them out, once only.
    expect(c.cup.drivers.filter((d) => d.name === ahead)).toHaveLength(1);
  });

  it('the winner of a season faces the runner-up', () => {
    const cup = newCareer().cup;
    finishSeason(cup, 1);
    const second = [...cup.drivers].sort((a, b) => b.profile.points - a.profile.points)[1].name;
    expect(pickRival(cup, cup)).toBe(second);
  });

  it('a new division brings a new rival', () => {
    for (let k = 0; k < 10; k++) {
      const c = newCareer();
      const old = rivalOf(c.cup)!.name;
      finishSeason(c.cup, 2);
      expect(endSeason(c).outcome).toBe('promoted');
      expect(rivalOf(c.cup)!.name).not.toBe(old);
    }
  });

  it('counts the head-to-head, pays for winning the duel', () => {
    const c = newCareer();
    const cup = c.cup;
    const me = humanDrivers(cup)[0];
    const r = rivalOf(cup)!;
    for (const [mine, theirs] of [[1, 2], [3, 2], [2, 5]]) {
      me.lastPlace = mine;
      r.lastPlace = theirs;
      recordDuel(cup);
    }
    expect(cup.duel).toEqual({ ahead: 2, behind: 1 });
    finishSeason(cup, 4);
    r.profile.points = me.profile.points - 7;
    expect(duelText(cup)).toBe('2-1 IN RACES, 7 PTS AHEAD');
    const duel = duelResult(cup, 1)!;
    expect(duel).toMatchObject({ name: r.name, won: true, gap: 7, bonus: 1000 });
    const money = me.profile.money;
    const result = endSeason(c);
    expect(result.rival?.won).toBe(true);
    expect(humanDrivers(c.cup)[0].profile.money).toBe(money + result.bonus + 1000);
    // Losing pays nothing.
    r.profile.points = me.profile.points + 1;
    expect(duelResult(cup, 1)).toMatchObject({ won: false, bonus: 0 });
  });

  it('the rival is marked in the race spec and hunts player 1', () => {
    const c = newCareer();
    const spec = nextRaceSpec(c.cup);
    const car = rivalCar(spec.entrants);
    expect(spec.entrants[car].name).toBe(rivalOf(c.cup)!.name);
    expect(spec.entrants[car].rival).toBe(0);
    expect(spec.entrants.filter((e) => e.rival !== undefined)).toHaveLength(1);
  });

  it('old saves load and get a rival', () => {
    const c = newCareer();
    delete c.cup.rival;
    delete c.cup.duel;
    saveCareer(c);
    const loaded = loadCareer()!;
    expect(rivalOf(loaded.cup)?.player).toBe(-1);
    expect(loaded.cup.duel).toEqual({ ahead: 0, behind: 0 });
  });

  it('setRival can bring in a driver from outside the field', () => {
    const c = newCareer();
    const outside = ['BLITZ', 'NITRO NINA', 'TURBO TOM', 'VIXEN', 'DIESEL DAN', 'ROXY', 'MAX POWER', 'ACE', 'SPARKY', 'LUCKY LOU']
      .find((n) => !c.cup.drivers.some((d) => d.name === n))!;
    setRival(c.cup, outside);
    expect(rivalOf(c.cup)!.name).toBe(outside);
    expect(c.cup.drivers).toHaveLength(8);
  });
});

describe('standings ties', () => {
  it('the table, the leader and the grid all break a tie on points by wins', () => {
    const c = newCareer().cup;
    c.drivers.forEach((d) => (d.profile.points = 10));
    const [a, b] = c.drivers.slice(-2);
    a.profile.points = b.profile.points = 50;
    b.profile.wins = 2;
    a.profile.wins = 1;
    expect(leader(c)).toBe(b);
    const rows = standingsRows(c);
    const sorted = [...rows].sort((x, y) => y.points - x.points || (y.wins ?? 0) - (x.wins ?? 0));
    expect(sorted[0].name).toBe(b.name);
    // The leader starts at the back of the grid.
    const spec = nextRaceSpec(c);
    expect(spec.entrants.at(-1)!.name).toBe(b.name);
  });
});
