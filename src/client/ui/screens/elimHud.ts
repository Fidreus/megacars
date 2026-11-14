// Elimination races on the HUD: cars left and when the next one goes (in
// place of the lap counter), the LAST PLACE warning, ELIMINATED, who just
// went out, and what an eliminated player can do while the race goes on.

import { carsLeft, ELIM, lapsToElimination } from '../../../shared/sim/elimination.ts';
import { RacePhase, type World } from '../../../shared/sim/world.ts';
import { drawText, textWidth } from '../font.ts';
import { ordinal, type HudRect } from './hud.ts';

const RED = '#ff3a2a';

/** Cars the place is counted against: those still in (an eliminated car keeps its final place out of all). */
export function fieldSize(world: World, carId: number): number {
  return world.elim && world.cars[carId].outOrder === 0 ? carsLeft(world) : world.cars.length;
}

/**
 * 0..1 on the lap that ends in an elimination: how far round it the leader
 * is (0 on other laps, or with fewer than two cars left).
 */
export function elimUrgency(world: World): number {
  if (!world.elim || world.race.phase !== RacePhase.Racing || carsLeft(world) < 2 || lapsToElimination(world) > 1) return 0;
  let lead = -Infinity;
  for (const c of world.cars) if (c.outOrder === 0 && c.raceDist > lead) lead = c.raceDist;
  // Race distance is 0 at the line and grows a lap length per lap.
  const len = world.elim.lapLength;
  if (!(len > 0) || lead < 0) return 0;
  return lead / len - Math.floor(lead / len);
}

/** The car is last of those still in (two or more left), racing. */
export function isLastPlace(world: World, carId: number): boolean {
  const car = world.cars[carId];
  if (!world.elim || car.outOrder > 0 || car.finished || world.race.phase !== RacePhase.Racing) return false;
  const left = carsLeft(world);
  return left >= 2 && car.place >= left;
}

/** Instead of "LAP 2/3": "5 LEFT" and when the next car goes. False in a normal race. */
export function drawElimStatus(ctx: CanvasRenderingContext2D, x: number, y: number, world: World, carId: number): boolean {
  if (!world.elim) return false;
  const left = carsLeft(world);
  const head = `${left} LEFT`;
  drawText(ctx, head, x, y, { scale: 2 });
  let note = '';
  let color = '#c8d0dc';
  if (world.cars[carId].outOrder > 0) note = 'YOU ARE OUT';
  else if (left <= 1) note = 'LAST CAR STANDING';
  else if (world.race.phase === RacePhase.Countdown) note = world.elim.every === 1 ? 'LAST CAR OUT EVERY LAP' : `LAST OUT EVERY ${world.elim.every} LAPS`;
  else {
    const n = lapsToElimination(world);
    note = n <= 1 ? 'OUT THIS LAP' : `OUT IN ${n} LAPS`;
    if (n <= 1) color = '#ff8a6a';
  }
  drawText(ctx, note, x + textWidth(head, 2) + 6, y + 5, { color });
  return true;
}

/** The message for the winner (null in a normal race). */
export function elimFinishText(world: World): string | null {
  return world.elim ? 'LAST CAR STANDING!' : null;
}

/** Per player view: LAST PLACE! with the gap to the car ahead, or ELIMINATED with the final place. */
export function drawElimAlerts(ctx: CanvasRenderingContext2D, r: HudRect, world: World, carId: number): void {
  if (!world.elim) return;
  const car = world.cars[carId];
  const cx = r.x + r.w / 2;
  const t = world.tick;
  if (car.outOrder > 0) {
    // A beat after the explosion, then it stays up while the camera follows the leader.
    if (t - car.outTick < 20 || world.race.phase === RacePhase.Finished) return;
    const y = Math.round(r.h * 0.26);
    drawText(ctx, 'ELIMINATED', cx, y, { scale: 3, color: RED, align: 'center' });
    drawText(ctx, `${ordinal(car.place)} PLACE - OUT ON LAP ${car.outLap}`, cx, y + 26, { scale: 1, color: '#ffffff', align: 'center' });
    return;
  }
  if (!isLastPlace(world, carId)) return;
  const u = elimUrgency(world);
  // Flashes, faster as the leader nears the line on a lap that ends in an elimination.
  const period = u > 0 ? Math.max(6, Math.round(30 - 24 * u)) : 30;
  const y = Math.round(r.h * 0.34);
  if (Math.floor(t / period) % 2 === 0) drawText(ctx, 'LAST PLACE!', cx, y, { scale: 3, color: RED, align: 'center' });
  // Gap to the car ahead, in seconds at the speed of the car in front.
  let ahead = -1;
  for (const c of world.cars) if (c.outOrder === 0 && c.place === car.place - 1) ahead = c.id;
  if (ahead >= 0) {
    const a = world.cars[ahead];
    const gap = Math.max(0, a.raceDist - car.raceDist) / Math.max(12, Math.hypot(a.vx, a.vz));
    drawText(ctx, `${gap.toFixed(1)} S TO ${ordinal(a.place)}`, cx, y + 26, { scale: 2, color: '#ffd84a', align: 'center' });
  }
}

/** Whole screen: "TURBO TOM IS OUT" for a few seconds after a car goes (split screen: lower, clear of both HUDs). */
export function drawElimNews(ctx: CanvasRenderingContext2D, W: number, H: number, world: World, names: readonly string[], players: readonly number[], split = false): void {
  if (!world.elim) return;
  let last = -1;
  for (const c of world.cars) if (c.outOrder > 0 && (last < 0 || c.outOrder > world.cars[last].outOrder)) last = c.id;
  if (last < 0) return;
  const age = world.tick - world.cars[last].outTick;
  if (age > 60 * 3) return;
  const mine = players.includes(last);
  const who = mine && players.length === 1 ? 'YOU ARE' : `${names[last] ?? `CAR ${last + 1}`} IS`;
  const y = Math.round(H * (split ? 0.6 : 0.12));
  ctx.fillStyle = 'rgba(40,0,0,0.6)';
  const text = `${who} OUT`;
  const w = textWidth(text, 2) + 16;
  ctx.fillRect(Math.round(W / 2 - w / 2), y - 4, w, 22);
  drawText(ctx, text, W / 2, y, { scale: 2, color: age < 12 && age % 4 < 2 ? '#ffffff' : RED, align: 'center' });
}

/**
 * Every local player is out and the race goes on: who the camera follows and
 * how to leave (offline only). Returns the rect of the touch button, if drawn.
 */
export function drawElimWatching(
  ctx: CanvasRenderingContext2D, W: number, H: number, world: World, players: readonly number[], online: boolean, touch: boolean,
): { x: number; y: number; w: number; h: number } | null {
  if (!allOut(world, players) || world.race.phase === RacePhase.Finished) return null;
  if (online) {
    drawText(ctx, 'WATCHING THE LEADER - THE RACE GOES ON', W / 2, H - 24, { color: '#ffd84a', align: 'center' });
    return null;
  }
  if (!canSkip(world, players)) return null;
  if (touch) {
    const r = { x: Math.round(W / 2 - 60), y: H - 34, w: 120, h: 22 };
    ctx.fillStyle = 'rgba(10,12,26,0.8)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(r.x, r.y + r.h - 1, r.w, 1);
    drawText(ctx, 'RESULTS NOW', W / 2, r.y + 7, { color: '#ffffff', align: 'center' });
    return r;
  }
  drawText(ctx, 'WATCHING THE LEADER - ENTER: RESULTS NOW', W / 2, H - 24, { color: '#ffd84a', align: 'center' });
  return null;
}

/** All local players are out of an elimination race. */
export function allOut(world: World, players: readonly number[]): boolean {
  return !!world.elim && players.length > 0 && players.every((id) => world.cars[id].outOrder > 0);
}

/** A moment after the last local player went out (no skipping with a button still held from driving). */
export function canSkip(world: World, players: readonly number[]): boolean {
  if (!allOut(world, players)) return false;
  let out = 0;
  for (const id of players) out = Math.max(out, world.cars[id].outTick);
  return world.tick - out >= ELIM.clearTicks / 2;
}

/** The camera stays on an eliminated car this long (the blast), then moves on. */
const WATCH_AFTER = 100;

/**
 * Cameras of eliminated players: in split screen the other player while they
 * are still in, otherwise the leader. Returns true when a camera changed car.
 */
export function spectateCars(world: World, players: readonly number[], viewCar: number[], leader: number): boolean {
  if (!world.elim) return false;
  let moved = false;
  players.forEach((id, p) => {
    const car = world.cars[id];
    const other = players.find((o) => o !== id && world.cars[o].outOrder === 0);
    const want = car.outOrder === 0 || world.tick - car.outTick < WATCH_AFTER ? id : other ?? leader;
    if (viewCar[p] !== want) {
      viewCar[p] = want;
      moved = true;
    }
  });
  return moved;
}

/** The results table's OUT column: the winner, or the lap the car went out on (null in a normal race). */
export function elimResult(world: World, carId: number): string | null {
  if (!world.elim) return null;
  const c = world.cars[carId];
  return c.outOrder > 0 ? `LAP ${c.outLap}` : c.finished ? 'WINNER' : '-';
}
