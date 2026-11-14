// HUD for the special items: the slot beside the ammunition with the held
// item's icon (or a running shield's time), and the warning when a homing
// missile is locked onto a local player's car.

import type { World } from '../../../shared/sim/world.ts';
import { SPECIAL, SPECIAL_NAMES, SpecialItem } from '../../../shared/sim/specials.ts';
import { ShotKind } from '../../../shared/sim/weapons.ts';
import { drawText } from '../font.ts';

/** Colour per special item. */
export const SPECIAL_COLOR: Record<number, string> = {
  [SpecialItem.Homing]: '#ff9d3a',
  [SpecialItem.Oil]: '#c89cff',
  [SpecialItem.Shield]: '#7ae8ff',
};

/** A 16x13 pixel icon of a special item with its top-left at (x, y). */
export function drawSpecialIcon(ctx: CanvasRenderingContext2D, item: number, x: number, y: number, dim = false): void {
  if (item === SpecialItem.Homing) {
    ctx.fillStyle = dim ? '#555' : '#ffb347';
    ctx.fillRect(x, y + 5, 14, 4);
    ctx.fillStyle = dim ? '#444' : '#ff5a1f';
    ctx.fillRect(x + 14, y + 6, 3, 2);
    ctx.fillRect(x, y + 3, 3, 8);
    // A curved trail ahead: the lock.
    ctx.fillStyle = dim ? '#444' : '#ffe08a';
    ctx.fillRect(x + 4, y + 1, 2, 2);
    ctx.fillRect(x + 8, y, 2, 2);
    ctx.fillRect(x + 12, y + 1, 2, 2);
  } else if (item === SpecialItem.Oil) {
    ctx.fillStyle = dim ? '#333' : '#15121c';
    ctx.fillRect(x + 1, y + 5, 15, 7);
    ctx.fillRect(x + 4, y + 3, 9, 10);
    ctx.fillStyle = dim ? '#555' : '#c89cff';
    ctx.fillRect(x + 4, y + 6, 4, 1);
    ctx.fillStyle = dim ? '#555' : '#7ae8ff';
    ctx.fillRect(x + 9, y + 8, 4, 1);
    ctx.fillStyle = dim ? '#555' : '#9cff9c';
    ctx.fillRect(x + 6, y + 10, 3, 1);
  } else if (item === SpecialItem.Shield) {
    ctx.fillStyle = dim ? '#555' : '#7ae8ff';
    ctx.fillRect(x + 2, y + 1, 12, 2);
    ctx.fillRect(x + 1, y + 3, 14, 5);
    ctx.fillRect(x + 3, y + 8, 10, 2);
    ctx.fillRect(x + 5, y + 10, 6, 2);
    ctx.fillRect(x + 7, y + 12, 2, 1);
    ctx.fillStyle = dim ? '#333' : '#1d4a66';
    ctx.fillRect(x + 4, y + 4, 8, 3);
  }
}

/**
 * The special slot: a framed box with the held item (dimmed outline when
 * empty) and, while a shield runs, its seconds left. `w` x 24 at (x, y).
 */
export function drawSpecialSlot(ctx: CanvasRenderingContext2D, x: number, y: number, car: World['cars'][number], tick: number, label = true): void {
  const w = label ? 90 : 26;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, 24);
  const held = car.special;
  ctx.strokeStyle = held ? SPECIAL_COLOR[held] : 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, 25, 23);
  if (held) drawSpecialIcon(ctx, held, x + 5, y + 5);
  if (!label) return;
  if (car.shieldTicks > 0) {
    // A shield up: its time left, blinking at the end.
    const sec = Math.ceil(car.shieldTicks / 60);
    if (car.shieldTicks > 60 || (tick >> 3) % 2 === 0) drawText(ctx, `SHIELD ${sec}`, x + 30, y + 8, { color: SPECIAL_COLOR[SpecialItem.Shield] });
  } else if (held) {
    const name = SPECIAL_NAMES[held];
    const sp = name.indexOf(' ');
    if (sp > 0) {
      drawText(ctx, name.slice(0, sp), x + 30, y + 3, { color: SPECIAL_COLOR[held] });
      drawText(ctx, name.slice(sp + 1), x + 30, y + 13, { color: SPECIAL_COLOR[held] });
    } else drawText(ctx, name, x + 30, y + 8, { color: SPECIAL_COLOR[held] });
  } else {
    drawText(ctx, 'NO ITEM', x + 30, y + 8, { color: '#6a7488' });
  }
}

/** Distance to the nearest homing missile locked onto car `id` (Infinity if none). */
export function lockDistance(world: World, id: number): number {
  const car = world.cars[id];
  let best = Infinity;
  for (const s of world.shots) {
    if (s.kind !== ShotKind.Homing || s.target !== id) continue;
    best = Math.min(best, Math.hypot(s.x - car.x, s.z - car.z));
  }
  return best;
}

/**
 * "MISSILE LOCK" warning for car `id`: a blinking banner that blinks faster
 * as the missile closes in, and an arrow toward it round the middle of the
 * viewport (`yaw`: the camera's turn, 0 for a north-up camera).
 */
export function drawLockWarning(ctx: CanvasRenderingContext2D, x0: number, w: number, h: number, world: World, id: number, yaw = 0): void {
  const car = world.cars[id];
  let s = null;
  let best = Infinity;
  for (const sh of world.shots) {
    if (sh.kind !== ShotKind.Homing || sh.target !== id) continue;
    const d = Math.hypot(sh.x - car.x, sh.z - car.z);
    if (d < best) {
      best = d;
      s = sh;
    }
  }
  if (!s) return;
  const close = Math.max(0, Math.min(1, 1 - best / SPECIAL.lockRange));
  const period = Math.round(16 - close * 12);
  const on = Math.floor(world.tick / period) % 2 === 0;
  const cx = x0 + w / 2;
  const y = Math.round(h * 0.36);
  if (on) {
    const text = 'MISSILE LOCK!';
    ctx.fillStyle = 'rgba(80,0,0,0.65)';
    ctx.fillRect(Math.round(cx - 62), y - 4, 124, 22);
    drawText(ctx, text, cx, y, { scale: 2, color: '#ff4a2a', align: 'center' });
  }
  // Where it comes from, round the edge of a circle about the screen centre.
  const ang = Math.atan2(s.x - car.x, -(s.z - car.z)) - yaw;
  const r = Math.min(w, h) * 0.3;
  const px = cx + Math.sin(ang) * r;
  const py = h / 2 - Math.cos(ang) * r;
  ctx.save();
  ctx.translate(Math.round(px), Math.round(py));
  ctx.rotate(ang);
  ctx.fillStyle = on ? '#ff4a2a' : '#ffb347';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(7, 4);
  ctx.lineTo(-7, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawText(ctx, `${Math.round(best)} M`, Math.round(px), Math.round(py) + 8, { color: '#ffd0c0', align: 'center' });
}
