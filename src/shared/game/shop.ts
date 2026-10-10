// Money, the shop and upgrades. A driver's profile carries over between
// races: cash, championship points, upgrade levels, ammo left and damage.
// Pure functions shared by the server (online seasons) and the client
// (offline championships), so prices and effects agree everywhere.

import { cloneTuning, type CarTuning } from '../config/tuning.ts';
import type { World } from '../sim/world.ts';
import { standings } from '../sim/world.ts';
import { START_AMMO } from '../sim/weapons.ts';

export const MAX_LEVEL = 3;

/** What a car brings to the start line. */
export interface Loadout {
  engine: number;
  tyres: number;
  armour: number;
  missiles: number;
  mines: number;
  turbos: number;
  /** 0..1, carried over until repaired. */
  damage: number;
}

export interface Profile extends Loadout {
  money: number;
  points: number;
  races: number;
  wins: number;
  /** Earnings from the latest race (shown after it). */
  lastEarned: number;
}

export const START_MONEY = 1000;

export function defaultLoadout(): Loadout {
  return { engine: 0, tyres: 0, armour: 0, ...START_AMMO, damage: 0 };
}

export function newProfile(): Profile {
  return { ...defaultLoadout(), money: START_MONEY, points: 0, races: 0, wins: 0, lastEarned: 0 };
}

export function loadoutOf(p: Loadout): Loadout {
  return {
    engine: p.engine, tyres: p.tyres, armour: p.armour,
    missiles: p.missiles, mines: p.mines, turbos: p.turbos, damage: p.damage,
  };
}

// ---------------------------------------------------------------- effects

/** Handling for a car with these upgrades. */
export function tuningFor(base: CarTuning, l: Loadout): CarTuning {
  const t = cloneTuning(base);
  t.accel0 *= 1 + 0.08 * l.engine;
  t.vTop *= 1 + 0.04 * l.engine;
  t.aGrip *= 1 + 0.07 * l.tyres;
  t.aSlide *= 1 + 0.05 * l.tyres;
  t.armour = 1 - 0.18 * l.armour;
  return t;
}

// ------------------------------------------------------------------- shop

export const UPGRADES = ['engine', 'tyres', 'armour'] as const;
export type Upgrade = (typeof UPGRADES)[number];
export const AMMO = ['missiles', 'mines', 'turbos'] as const;
export type Ammo = (typeof AMMO)[number];
export type ShopItem = Upgrade | Ammo | 'repair';

/** Price of the next level (index = current level). */
export const UPGRADE_PRICES: Record<Upgrade, readonly number[]> = {
  engine: [1500, 2800, 4500],
  tyres: [1000, 2000, 3200],
  armour: [1200, 2400, 3800],
};
export const AMMO_PRICE: Record<Ammo, number> = { missiles: 60, mines: 50, turbos: 90 };
export const AMMO_MAX: Record<Ammo, number> = { missiles: 12, mines: 8, turbos: 6 };
/** Price of repairing all damage (1.0). */
export const REPAIR_PRICE = 800;

export function isShopItem(x: unknown): x is ShopItem {
  return x === 'repair' || (UPGRADES as readonly unknown[]).includes(x) || (AMMO as readonly unknown[]).includes(x);
}

/** Cost of buying `item` once, or null when it can't be bought (maxed, nothing to repair). */
export function priceOf(p: Loadout, item: ShopItem): number | null {
  if (item === 'repair') return p.damage > 0.005 ? Math.ceil(p.damage * REPAIR_PRICE) : null;
  if ((UPGRADES as readonly string[]).includes(item)) {
    const lvl = p[item as Upgrade];
    return lvl >= MAX_LEVEL ? null : UPGRADE_PRICES[item as Upgrade][lvl];
  }
  const a = item as Ammo;
  return p[a] >= AMMO_MAX[a] ? null : AMMO_PRICE[a];
}

/**
 * Buy one of `item`. Repairs as much as the money allows. Returns an error
 * text, or null when the profile was changed.
 */
export function buy(p: Profile, item: ShopItem): string | null {
  const price = priceOf(p, item);
  if (price === null) return item === 'repair' ? 'NOTHING TO REPAIR' : 'MAXED OUT';
  if (item === 'repair') {
    if (p.money <= 0) return 'NO MONEY';
    const fix = Math.min(p.damage, p.money / REPAIR_PRICE);
    p.money -= Math.ceil(fix * REPAIR_PRICE);
    p.damage = Math.max(0, +(p.damage - fix).toFixed(4));
    return null;
  }
  if (p.money < price) return 'NOT ENOUGH MONEY';
  p.money -= price;
  if ((UPGRADES as readonly string[]).includes(item)) p[item as Upgrade]++;
  else p[item as Ammo]++;
  return null;
}

// ------------------------------------------------------------ race results

export const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
export const PRIZES = [1200, 900, 700, 550, 450, 350, 250, 200];
export const HIT_BONUS = 40;
export const KILL_BONUS = 150;

export interface CarResult {
  car: number;
  place: number;
  points: number;
  prize: number;
  bonus: number;
}

/** Points and money for every car from a finished world. */
export function raceResults(w: World): CarResult[] {
  const order = standings(w);
  return order.map((car, i) => {
    const c = w.cars[car];
    return {
      car,
      place: i + 1,
      points: POINTS[i] ?? 0,
      prize: PRIZES[i] ?? 0,
      bonus: c.hits * HIT_BONUS + c.kills * KILL_BONUS,
    };
  });
}

/** Fold one car's race into its driver's profile: cash, points, ammo left, damage. */
export function settle(p: Profile, w: World, r: CarResult): void {
  const c = w.cars[r.car];
  p.lastEarned = r.prize + r.bonus;
  p.money += p.lastEarned;
  p.points += r.points;
  p.races++;
  if (r.place === 1) p.wins++;
  p.missiles = c.missiles;
  p.mines = c.mines;
  p.turbos = c.turbos;
  // A wrecked-and-patched car keeps its damage; finishing heals nothing.
  p.damage = Math.min(1, +c.damage.toFixed(4));
}

// ---------------------------------------------------------- computer cars

/**
 * Computer drivers keep up with the people: their upgrade level follows the
 * average human level, shifted by difficulty, with a little variety.
 */
export function aiLoadout(humanLevel: number, difficulty: number, rnd: () => number): Loadout {
  const l = defaultLoadout();
  for (const u of UPGRADES) {
    const lvl = Math.round(humanLevel + (difficulty - 1) * 0.7 + (rnd() - 0.5) * 1.2);
    l[u] = Math.max(0, Math.min(MAX_LEVEL, lvl));
  }
  return l;
}

/** Average upgrade level of some profiles (0..3). */
export function averageLevel(ps: readonly Loadout[]): number {
  if (ps.length === 0) return 0;
  let sum = 0;
  for (const p of ps) sum += (p.engine + p.tyres + p.armour) / 3;
  return sum / ps.length;
}
