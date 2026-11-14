// HUD readout for item crates: what a local player just got ("+2 MISSILES"
// with its icon), shown for a moment near the weapons panel. Pickups are
// noted from the simulation events each tick; drawing reads them per frame.

import { CrateItem, crateContent } from '../../../shared/sim/crates.ts';
import { Ev, type EventBuffer } from '../../../shared/sim/events.ts';
import { drawText, textWidth } from '../font.ts';
import { drawSpecialIcon, SPECIAL_COLOR } from './specialHud.ts';
import { SpecialItem } from '../../../shared/sim/specials.ts';

/** How long the readout stays up, in ticks. */
const SHOW_TICKS = 110;

interface Got {
  item: number;
  amount: number;
  tick: number;
}

/** Latest pickup per car id. */
const latest = new Map<number, Got>();

/** Note this tick's pickups. `tick`: the world tick after the step. */
export function noteCratePickups(ev: EventBuffer, tick: number): void {
  for (let k = 0; k < ev.count; k++) {
    const e = ev.list[k];
    if (e.kind !== Ev.CratePickup) continue;
    let g = latest.get(e.car);
    if (!g) latest.set(e.car, (g = { item: 0, amount: 0, tick: 0 }));
    g.item = e.other;
    g.amount = e.value;
    g.tick = tick;
  }
}

/** Icon and colour per item kind; a new kind adds a line here. */
const LOOK: Record<number, { color: string; icon: (ctx: CanvasRenderingContext2D, x: number, y: number) => void }> = {
  [CrateItem.Missiles]: {
    color: '#ff8a7a',
    icon: (ctx, x, y) => {
      ctx.fillStyle = '#e8e6e0';
      ctx.fillRect(x, y + 4, 16, 5);
      ctx.fillStyle = '#d42a24';
      ctx.fillRect(x + 16, y + 5, 3, 3);
      ctx.fillRect(x, y + 2, 3, 9);
    },
  },
  [CrateItem.Mines]: {
    color: '#ffb0a0',
    icon: (ctx, x, y) => {
      ctx.fillStyle = '#2a2c30';
      ctx.fillRect(x + 1, y + 2, 14, 10);
      ctx.fillStyle = '#8a8f98';
      ctx.fillRect(x, y + 4, 16, 6);
      ctx.fillStyle = '#ff2b1c';
      ctx.fillRect(x + 6, y + 5, 4, 4);
    },
  },
  [CrateItem.Turbo]: {
    color: '#9cdcff',
    icon: (ctx, x, y) => {
      ctx.fillStyle = '#6fd0ff';
      ctx.fillRect(x, y + 4, 12, 5);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 12, y + 2, 5, 9);
    },
  },
  [CrateItem.Repair]: {
    color: '#9cff9c',
    icon: (ctx, x, y) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 2, y + 1, 12, 12);
      ctx.fillStyle = '#2fbf4a';
      ctx.fillRect(x + 6, y + 3, 4, 8);
      ctx.fillRect(x + 4, y + 5, 8, 4);
    },
  },
  [CrateItem.Homing]: { color: SPECIAL_COLOR[SpecialItem.Homing], icon: (ctx, x, y) => drawSpecialIcon(ctx, SpecialItem.Homing, x, y) },
  [CrateItem.Oil]: { color: SPECIAL_COLOR[SpecialItem.Oil], icon: (ctx, x, y) => drawSpecialIcon(ctx, SpecialItem.Oil, x, y) },
  [CrateItem.Shield]: { color: SPECIAL_COLOR[SpecialItem.Shield], icon: (ctx, x, y) => drawSpecialIcon(ctx, SpecialItem.Shield, x, y) },
};

/** "+2 MISSILES", "+1 TURBO", "REPAIR 30%". */
export function crateText(item: number, amount: number): string {
  const c = crateContent(item);
  if (!c) return '';
  if (item === CrateItem.Repair) return `${c.label} ${amount}%`;
  // A special item goes into the slot: just its name.
  if (item >= CrateItem.Homing) return c.label;
  const label = amount === 1 && c.label.endsWith('S') ? c.label.slice(0, -1) : c.label;
  return `+${amount} ${label}`;
}

/**
 * Draw car `carId`'s latest pickup with its top-left at (x, y) while it is
 * fresh: it pops in, holds, and blinks out.
 */
export function drawCrateReadout(ctx: CanvasRenderingContext2D, x: number, y: number, carId: number, tick: number): void {
  const g = latest.get(carId);
  if (!g) return;
  const age = tick - g.tick;
  // A new race (or a rewind past it) starts the clock again.
  if (age < 0 || age >= SHOW_TICKS) return;
  if (age > SHOW_TICKS - 24 && (age >> 2) % 2 === 1) return;
  const look = LOOK[g.item];
  const text = crateText(g.item, g.amount);
  if (!look || !text) return;
  const scale = age < 4 ? 1 : 2;
  const w = 22 + textWidth(text, scale);
  // Slides in from the left over the first few ticks.
  const dx = Math.round(Math.max(0, 6 - age) * -3);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x - 4 + dx, y - 2, w + 8, 18);
  look.icon(ctx, x + dx, y + 1);
  drawText(ctx, text, x + 22 + dx, y + 1, { scale, color: age < 8 && (age >> 1) % 2 === 0 ? '#ffffff' : look.color });
}
