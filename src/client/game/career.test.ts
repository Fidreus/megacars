import { describe, expect, it } from 'vitest';
import { humanDrivers } from './championship.ts';
import { endSeason, newCareer, seasonPlace } from './career.ts';

/** Pretend the season has been run with the player finishing at `place`. */
function finishSeason(c: ReturnType<typeof newCareer>, place: number): void {
  const others = c.cup.drivers.filter((d) => d.player < 0);
  others.forEach((d, i) => (d.profile.points = 100 - i * 10));
  // Slot the player in just above the driver currently at `place`.
  humanDrivers(c.cup)[0].profile.points = place === 1 ? 200 : 100 - (place - 2) * 10 - 5;
  c.cup.race = c.cup.tracks.length;
}

describe('career', () => {
  it('starts in division 3 with a fresh car', () => {
    const c = newCareer();
    expect(c.division).toBe(3);
    expect(c.cup.difficulty).toBe(0);
    expect(c.cup.drivers).toHaveLength(8);
  });

  it('moves you up for a top-3 season, keeps you down otherwise', () => {
    const c = newCareer();
    finishSeason(c, 5);
    expect(seasonPlace(c)).toBe(5);
    expect(endSeason(c).outcome).toBe('stayed');
    expect(c.division).toBe(3);
    finishSeason(c, 2);
    const money = humanDrivers(c.cup)[0].profile.money;
    const r = endSeason(c);
    expect(r.outcome).toBe('promoted');
    expect(c.division).toBe(2);
    expect(c.cup.difficulty).toBe(1);
    // Money carries over with the bonus; points start from zero.
    expect(humanDrivers(c.cup)[0].profile.money).toBe(money + r.bonus);
    expect(humanDrivers(c.cup)[0].profile.points).toBe(0);
  });

  it('crowns a champion for winning division 1', () => {
    const c = newCareer();
    finishSeason(c, 1);
    endSeason(c);
    finishSeason(c, 1);
    endSeason(c);
    expect(c.division).toBe(1);
    finishSeason(c, 1);
    expect(endSeason(c).outcome).toBe('champion');
    expect(c.titles).toBe(1);
    finishSeason(c, 1);
    expect(endSeason(c).outcome).toBe('defended');
    expect(c.division).toBe(1);
  });
});
