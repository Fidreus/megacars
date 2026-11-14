// Paint jobs for the player's car: a body colour and a bold pattern in a second
// colour. A few are free, the rest are unlocked by achievements and medals.
// The choice is saved in the browser and used in the offline modes.

import { CAR_COLORS } from '../../shared/game/roster.ts';

/** Patterns, all laid on the top of the body (the car is small and seen from above). */
export type PaintPattern = 'plain' | 'stripe' | 'dual' | 'twotone' | 'halves' | 'bands' | 'chequer';

/** What the car mesh needs besides the body colour. */
export interface PaintLook {
  accent: string;
  pattern: PaintPattern;
}

export type Unlock =
  | { kind: 'free' }
  | { kind: 'achievement'; id: string }
  /** This many medals of at least this colour (1 bronze, 2 silver, 3 gold), over all tracks and leagues. */
  | { kind: 'medals'; tier: 1 | 2 | 3; count: number };

export interface PaintJob extends PaintLook {
  id: string;
  name: string;
  /** The main colour (null = the grid slot's own colour). */
  body: string | null;
  unlock: Unlock;
}

/** What decides whether a paint is unlocked. */
export interface UnlockState {
  achieved(id: string): boolean;
  /** Medals of at least this colour, 1..3 (see MedalTotals.atLeast). */
  medals: readonly number[];
}

/** The paints, easiest first. `achievement` ids are those of achievementRules.ts. */
export const PAINTS: readonly PaintJob[] = [
  { id: 'stock', name: 'STOCK', body: null, accent: '#f2f2ea', pattern: 'stripe', unlock: { kind: 'free' } },
  { id: 'ice', name: 'ICE WHITE', body: '#eef2f6', accent: '#2f6fe0', pattern: 'stripe', unlock: { kind: 'free' } },
  { id: 'sunshine', name: 'SUNSHINE', body: '#f6c91c', accent: '#1a1a22', pattern: 'dual', unlock: { kind: 'free' } },
  { id: 'british', name: 'BRITISH GREEN', body: '#1f9a52', accent: '#f4f0dc', pattern: 'stripe', unlock: { kind: 'free' } },
  { id: 'tangerine', name: 'TANGERINE', body: '#ff7a1a', accent: '#15161a', pattern: 'twotone', unlock: { kind: 'achievement', id: 'finish' } },
  { id: 'learner', name: 'L-PLATE', body: '#f6f6ec', accent: '#2fb04a', pattern: 'bands', unlock: { kind: 'achievement', id: 'school' } },
  { id: 'bubblegum', name: 'BUBBLEGUM', body: '#ff6fb5', accent: '#ffffff', pattern: 'halves', unlock: { kind: 'achievement', id: 'win' } },
  { id: 'sidewinder', name: 'SIDEWINDER', body: '#28c4d0', accent: '#8a3ddc', pattern: 'dual', unlock: { kind: 'achievement', id: 'drift' } },
  { id: 'neon', name: 'NEON NIGHT', body: '#7a46f0', accent: '#38f0ff', pattern: 'stripe', unlock: { kind: 'achievement', id: 'night' } },
  { id: 'bronze', name: 'BRONZE AGE', body: '#cf8a4c', accent: '#5a3414', pattern: 'twotone', unlock: { kind: 'medals', tier: 1, count: 3 } },
  { id: 'hazard', name: 'HAZARD', body: '#ffd400', accent: '#16161a', pattern: 'bands', unlock: { kind: 'achievement', id: 'wrecker' } },
  { id: 'chequered', name: 'CHEQUERED', body: '#f4f4ee', accent: '#15161a', pattern: 'chequer', unlock: { kind: 'achievement', id: 'podiums' } },
  { id: 'silver', name: 'SILVER ARROW', body: '#c9d2e0', accent: '#2a5fd0', pattern: 'stripe', unlock: { kind: 'medals', tier: 2, count: 5 } },
  { id: 'champion', name: 'CHAMPION', body: '#e8322a', accent: '#ffd84a', pattern: 'bands', unlock: { kind: 'achievement', id: 'champion' } },
  { id: 'gold', name: 'GOLD RUSH', body: '#ffd02a', accent: '#ffffff', pattern: 'dual', unlock: { kind: 'medals', tier: 3, count: 3 } },
  { id: 'midas', name: 'MIDAS', body: '#ffc61a', accent: '#15161a', pattern: 'halves', unlock: { kind: 'achievement', id: 'goldAll' } },
];

export const DEFAULT_PAINT = PAINTS[0].id;

export function paintById(id: string): PaintJob {
  return PAINTS.find((p) => p.id === id) ?? PAINTS[0];
}

export function isUnlocked(p: PaintJob, s: UnlockState): boolean {
  const u = p.unlock;
  if (u.kind === 'free') return true;
  if (u.kind === 'achievement') return s.achieved(u.id);
  return (s.medals[u.tier] ?? 0) >= u.count;
}

/** What it takes, for the paint shop ("WIN A RACE"); achievement names are looked up by the caller. */
export function unlockText(p: PaintJob, achievementText: (id: string) => string): string {
  const u = p.unlock;
  if (u.kind === 'free') return 'FREE';
  if (u.kind === 'achievement') return achievementText(u.id);
  const colour = ['', 'MEDALS', 'SILVER OR GOLD MEDALS', 'GOLD MEDALS'][u.tier];
  return `EARN ${u.count} ${colour}`;
}

// ------------------------------------------------------------- the choice

const KEY = 'megacars.paint.v1';

export function loadPaintChoice(): string {
  try {
    return paintById(localStorage.getItem(KEY) ?? DEFAULT_PAINT).id;
  } catch {
    return DEFAULT_PAINT;
  }
}

export function savePaintChoice(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Not remembered.
  }
}

// ------------------------------------------------------ in a race

let active: PaintJob = PAINTS[0];

/** The paint the player's car gets in the offline races that start from now on. */
export function setActivePaint(p: PaintJob): void {
  active = p;
}

export function activePaint(): PaintJob {
  return active;
}

/** How alike two '#rrggbb' colours look (0 = the same, about 441 = black and white). */
export function colorDistance(a: string, b: string): number {
  const c = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return Math.hypot(c(a, 0) - c(b, 0), c(a, 1) - c(b, 1), c(a, 2) - c(b, 2));
}

/** Colours this close are hard to tell apart on the track. */
export const TOO_ALIKE = 90;

/** Spare colours for computer cars that have to change (after the slot colours). */
const SPARE_COLORS = ['#8a5a2b', '#ff6fb5', '#a0d83a', '#8a93a6', '#1f8a8a'];

export interface PaintedGrid {
  colors: string[];
  looks: (PaintLook | undefined)[];
}

/**
 * The player's car in its paint, and computer cars that would look like it
 * given another colour (one from the slot colours that nobody has).
 * `colors` are the slot colours of the grid; `player` the car to paint.
 */
export function paintGrid(colors: readonly string[], player: number, paint: PaintJob): PaintedGrid {
  const out = [...colors];
  const looks: (PaintLook | undefined)[] = colors.map(() => undefined);
  if (paint.body === null || player < 0 || player >= colors.length) return { colors: out, looks };
  out[player] = paint.body;
  looks[player] = { accent: paint.accent, pattern: paint.pattern };
  for (let i = 0; i < out.length; i++) {
    if (i === player || colorDistance(out[i], paint.body) >= TOO_ALIKE) continue;
    const free = [...CAR_COLORS, ...SPARE_COLORS].filter((c) => colorDistance(c, paint.body!) >= TOO_ALIKE && !out.some((o, j) => j !== i && colorDistance(o, c) < 40));
    out[i] = free[0] ?? out[i];
  }
  return { colors: out, looks };
}
