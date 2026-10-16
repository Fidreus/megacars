import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { AI_SKILL } from './roster.ts';
import { createRaceWorld } from './raceSetup.ts';
import {
  AMMO_MAX, buy, CAR_MODELS, defaultLoadout, newProfile, POINTS, priceOf, raceResults, REPAIR_PRICE, settle, START_MONEY, TOW_FEE, tuningFor,
  UPGRADE_PRICES, type Loadout,
} from './shop.ts';
import { stepWorld } from '../sim/step.ts';
import { RacePhase } from '../sim/world.ts';
import type { RaceSpec } from '../net/protocol.ts';

function aiRace(track: string, loadouts: (Loadout | undefined)[], weapons = true): RaceSpec {
  return {
    id: 1, track, laps: 1, seed: 11, countdownTicks: 1, weapons,
    entrants: loadouts.map((loadout, i) => ({ name: `C${i}`, color: '#fff', playerId: -1, skill: AI_SKILL[1], loadout })),
  };
}

function run(spec: RaceSpec) {
  const r = createRaceWorld(spec);
  while (r.world.race.phase !== RacePhase.Finished && r.world.tick < 60 * 60 * 6) stepWorld(r.world, r.track, [], r.tunings);
  return r;
}

describe('shop', () => {
  it('sells upgrades level by level until maxed', () => {
    const p = newProfile();
    p.money = 100_000;
    for (let lvl = 0; lvl < 3; lvl++) {
      expect(priceOf(p, 'engine')).toBe(UPGRADE_PRICES.engine[lvl]);
      expect(buy(p, 'engine')).toBeNull();
    }
    expect(p.engine).toBe(3);
    expect(buy(p, 'engine')).toBe('MAXED OUT');
    expect(p.money).toBe(100_000 - UPGRADE_PRICES.engine.reduce((a, b) => a + b, 0));
  });

  it('refuses what you cannot afford and caps ammo', () => {
    const p = newProfile();
    expect(buy(p, 'engine')).toBe('NOT ENOUGH MONEY');
    expect(p.money).toBe(START_MONEY);
    p.money = 100_000;
    while (buy(p, 'missiles') === null);
    expect(p.missiles).toBe(AMMO_MAX.missiles);
  });

  it('repairs as much as the money allows', () => {
    const p = newProfile();
    p.damage = 0.5;
    p.money = REPAIR_PRICE * 0.2;
    expect(buy(p, 'repair')).toBeNull();
    expect(p.damage).toBeCloseTo(0.3, 5);
    expect(p.money).toBe(0);
    expect(buy(p, 'repair')).toBe('NO MONEY');
  });

  it('sells better cars in order, keeping upgrades and leaving damage behind', () => {
    const p = newProfile();
    p.money = 20_000;
    p.engine = 1;
    p.damage = 0.4;
    expect(priceOf(p, 'car')).toBe(CAR_MODELS[1].price);
    expect(buy(p, 'car')).toBeNull();
    expect(p.car).toBe(1);
    expect(p.engine).toBe(1);
    expect(p.damage).toBe(0);
    expect(buy(p, 'car')).toBeNull();
    expect(buy(p, 'car')).toBe('MAXED OUT');
    const stock = tuningFor(DEFAULT_TUNING, defaultLoadout());
    const brute = tuningFor(DEFAULT_TUNING, { ...defaultLoadout(), car: 2 });
    expect(brute.accel0).toBeGreaterThan(stock.accel0);
    expect(brute.armour).toBeLessThan(stock.armour);
  });

  it('upgrades change the handling', () => {
    const t = tuningFor(DEFAULT_TUNING, { ...defaultLoadout(), engine: 3, tyres: 2, armour: 1 });
    expect(t.vTop).toBeGreaterThan(DEFAULT_TUNING.vTop);
    expect(t.accel0).toBeGreaterThan(DEFAULT_TUNING.accel0);
    expect(t.aGrip).toBeGreaterThan(DEFAULT_TUNING.aGrip);
    expect(t.armour).toBeLessThan(1);
  });

  it('a fully upgraded car beats stock ones, and everybody still finishes', () => {
    const top = { ...defaultLoadout(), engine: 3, tyres: 3, armour: 3 };
    // Car 0 starts at the front, so put the upgraded car at the back of the grid.
    const { world } = run(aiRace('greenvalley', [undefined, undefined, undefined, top], false));
    expect(world.race.finishOrder).toHaveLength(4);
    expect(world.race.finishOrder[0]).toBe(3);
  });

  it('pays out by place and bonus, and carries ammo and damage over', () => {
    const { world } = run(aiRace('dustbowl', [undefined, undefined, undefined, undefined, undefined, undefined]));
    const results = raceResults(world);
    expect(results.map((r) => r.points)).toEqual(POINTS.slice(0, 6));
    const r = results[0];
    const p = newProfile();
    settle(p, world, r);
    expect(p.money).toBe(START_MONEY + r.prize + r.bonus - r.tow);
    expect(p.points).toBe(10);
    expect(p.wins).toBe(1);
    expect(p.missiles).toBe(world.cars[r.car].missiles);
    expect(p.damage).toBeCloseTo(world.cars[r.car].damage, 3);
    // Somebody scored hits with the weapons.
    expect(results.some((x) => x.bonus > 0)).toBe(true);
  });

  it('charges a tow for every wreck, never below zero cash', () => {
    const { world } = run(aiRace('dustbowl', [undefined, undefined]));
    const r = raceResults(world)[1];
    world.cars[r.car].wrecks = 2;
    const [again] = raceResults(world).filter((x) => x.car === r.car);
    expect(again.tow).toBe(2 * TOW_FEE);
    const p = newProfile();
    p.money = 0;
    settle(p, world, { ...again, prize: 0, bonus: 0 });
    expect(p.money).toBe(0);
    expect(p.lastEarned).toBe(0);
  });
});
