// In-race HUD: position, laps, times, speed, start lights, messages and a
// minimap. Drawn per viewport on the low-res UI canvas.

import { DT } from '../../../shared/config/constants.ts';
import type { Track } from '../../../shared/track/types.ts';
import type { World } from '../../../shared/sim/world.ts';
import { RacePhase } from '../../../shared/sim/world.ts';
import { lightsOn } from '../../game/raceView.ts';
import { drawText, textWidth } from '../font.ts';
import { drawDriveMeter } from './driveHud.ts';
import { drawElimAlerts, drawElimStatus, elimFinishText, fieldSize } from './elimHud.ts';
import { drawCrateReadout } from './crateHud.ts';

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
  return `${n}${n % 10 > 3 ? 'TH' : s}`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

export interface HudRect {
  x: number;
  w: number;
  h: number;
}

const YELLOW = '#ffd84a';

/** Position, lap, times and speed for one player's viewport. */
/** `touch`: on-screen controls fill the bottom corners, so speed and arsenal go to the top. */
/** `title`: what a session without laps is called (PRACTICE). */
export function drawPlayerHud(ctx: CanvasRenderingContext2D, r: HudRect, world: World, carId: number, label: string | null, touch = false, title = 'PRACTICE'): void {
  const car = world.cars[carId];
  const race = world.race;
  const x = r.x + 6;
  const practice = race.laps === 0;
  if (!practice) {
    const pos = String(car.place);
    drawText(ctx, pos, x, 6, { scale: 4, color: YELLOW });
    const px = x + textWidth(pos, 4) + 3;
    drawText(ctx, ordinal(car.place).slice(pos.length), px, 6, { scale: 2, color: YELLOW });
    drawText(ctx, `/${fieldSize(world, carId)}`, px, 22, { color: '#d0d0d0' });
    const lap = Math.max(1, Math.min(race.laps, car.lap));
    if (!drawElimStatus(ctx, x, 40, world, carId)) drawText(ctx, `LAP ${lap}/${race.laps}`, x, 40, { scale: 2 });
  } else {
    drawText(ctx, title, x, 6, { scale: 2, color: YELLOW });
    drawText(ctx, car.lap > 0 ? `LAP ${car.lap}` : 'START', x, 24, { scale: 2 });
  }
  const lapTime = car.lap > 0 && !car.finished ? (world.tick - car.lapStartTick) * DT : 0;
  let y = practice ? 44 : 58;
  drawText(ctx, formatTime(lapTime), x, y);
  y += 9;
  if (car.lastLapTicks) drawText(ctx, `LAST ${formatTime(car.lastLapTicks * DT)}`, x, y, { color: '#b8c8ff' });
  y += 9;
  if (car.bestLapTicks) drawText(ctx, `BEST ${formatTime(car.bestLapTicks * DT)}`, x, y, { color: '#9cff9c' });
  if (label) drawText(ctx, label, r.x + r.w - 6, 6, { scale: 2, color: label === 'P1' ? '#ff6b5e' : '#6fa0ff', align: 'right' });

  // Touch: the bottom corners belong to the thumbs; go under the lap times.
  const top = practice ? 76 : 92;
  if (race.weapons) {
    // Touch: the ammo is on the buttons, so only a small damage bar here.
    if (touch) drawDamageBar(ctx, x, top, car);
    else drawArsenal(ctx, x, r.h - 46, car);
    // What a crate just gave: above the weapons panel (touch: under the speed).
    drawCrateReadout(ctx, x, touch ? top + 32 : r.h - 82, carId, world.tick);
  }
  const grace = race.startTick + 180 - world.tick;
  if (race.weapons && race.phase === RacePhase.Racing && grace > -90 && !practice) {
    const text = grace > 0 ? `WEAPONS IN ${Math.ceil(grace / 60)}` : 'WEAPONS FREE!';
    drawText(ctx, text, r.x + r.w / 2, r.h * 0.25, { scale: 2, color: grace > 0 ? '#c8d0dc' : '#ff6b5e', align: 'center' });
  }

  const kmh = Math.round(Math.hypot(car.vx, car.vz) * 3.6);
  const sx = x;
  const sy = touch ? (race.weapons ? top + 14 : top - 10) : r.h - 22;
  drawText(ctx, `${kmh}`, sx, sy, { scale: 2 });
  drawText(ctx, 'KM/H', sx + 4 + String(kmh).length * 12, sy + 7, { color: '#c0c0c0' });
  drawDriveMeter(ctx, sx + 10 + 3 * 12 + textWidth('KM/H'), sy + 3, car, world.tick);

  const cx = r.x + r.w / 2;
  if (car.finished) {
    drawText(ctx, elimFinishText(world) ?? `FINISHED ${ordinal(race.finishOrder.indexOf(carId) + 1)}!`, cx, r.h * 0.28, { scale: 3, color: YELLOW, align: 'center' });
  } else if (car.wrongWayTicks > 90 && race.phase === RacePhase.Racing) {
    if (Math.floor(world.tick / 15) % 2 === 0) drawText(ctx, 'WRONG WAY!', cx, r.h * 0.3, { scale: 3, color: '#ff4a3a', align: 'center' });
  }
  drawElimAlerts(ctx, r, world, carId);
}

function damageColor(car: World['cars'][number]): string {
  const d = car.damage;
  return car.wreckTicks > 0 ? '#ff2b1c' : d < 0.4 ? '#9cff9c' : d < 0.7 ? '#ffd84a' : '#ff6b5e';
}

/** Compact damage bar (touch layout). */
function drawDamageBar(ctx: CanvasRenderingContext2D, x: number, y: number, car: World['cars'][number]): void {
  const w = 74;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 3, y - 3, w, 12);
  drawText(ctx, 'DMG', x, y - 1, { color: '#9aa4b8' });
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 22, y, w - 29, 5);
  ctx.fillStyle = damageColor(car);
  ctx.fillRect(x + 22, y, Math.round((w - 29) * Math.min(1, car.damage)), 5);
}

/** Missiles, mines and turbos left (big), and a damage bar. */
function drawArsenal(ctx: CanvasRenderingContext2D, x: number, y: number, car: World['cars'][number]): void {
  const w = 150;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 4, y - 16, w, 36);
  // Damage bar.
  const d = Math.min(1, car.damage);
  drawText(ctx, 'DAMAGE', x, y - 13, { color: '#9aa4b8' });
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 40, y - 13, w - 50, 6);
  ctx.fillStyle = damageColor(car);
  ctx.fillRect(x + 40, y - 13, Math.round((w - 50) * d), 6);
  // Ammo: missile, mine, turbo icons with big counts.
  const icon = (ix: number, kind: number, n: number) => {
    const dim = n === 0;
    const iy = y + 1;
    if (kind === 0) {
      ctx.fillStyle = dim ? '#555' : '#e8e6e0';
      ctx.fillRect(ix, iy + 4, 16, 5);
      ctx.fillStyle = dim ? '#444' : '#d42a24';
      ctx.fillRect(ix + 16, iy + 5, 3, 3);
      ctx.fillRect(ix, iy + 2, 3, 9);
    } else if (kind === 1) {
      ctx.fillStyle = dim ? '#444' : '#2a2c30';
      ctx.fillRect(ix + 1, iy + 2, 14, 10);
      ctx.fillStyle = dim ? '#555' : '#8a8f98';
      ctx.fillRect(ix, iy + 4, 16, 6);
      ctx.fillStyle = dim ? '#555' : '#ff2b1c';
      ctx.fillRect(ix + 6, iy + 5, 4, 4);
    } else {
      ctx.fillStyle = dim ? '#555' : '#6fd0ff';
      ctx.fillRect(ix, iy + 4, 12, 5);
      ctx.fillStyle = dim ? '#444' : '#ffffff';
      ctx.fillRect(ix + 12, iy + 2, 5, 9);
    }
    drawText(ctx, String(n), ix + 22, iy, { scale: 2, color: dim ? '#6a7488' : '#ffffff' });
  };
  icon(x, 0, car.missiles);
  icon(x + 50, 1, car.mines);
  icon(x + 100, 2, car.turbos);
}

/** Start lights and "GO!" at the top centre of the screen. */
export function drawCountdown(ctx: CanvasRenderingContext2D, W: number, world: World): void {
  const race = world.race;
  const t = world.tick;
  if (race.laps === 0) return;
  if (race.phase === RacePhase.Countdown) {
    const lit = lightsOn(t, race.startTick);
    const size = 12;
    const gap = 6;
    const total = 5 * size + 4 * gap;
    const x0 = Math.round(W / 2 - total / 2);
    ctx.fillStyle = '#111';
    ctx.fillRect(x0 - 5, 34, total + 10, size + 10);
    for (let k = 0; k < 5; k++) {
      ctx.fillStyle = k < lit ? '#ff2a1c' : '#3a1010';
      ctx.fillRect(x0 + k * (size + gap), 39, size, size);
    }
    if (lit === 0) drawText(ctx, 'GET READY', W / 2, 60, { scale: 2, align: 'center' });
  } else if (t - race.startTick < 70) {
    drawText(ctx, 'GO!', W / 2, 40, { scale: 5, color: '#5aff6a', align: 'center' });
  }
}

/** Track outline with car dots; the outline is pre-rendered once per track and size. */
export class Minimap {
  private canvas: HTMLCanvasElement | null = null;
  private key = '';
  private scale = 1;
  private ox = 0;
  private oz = 0;

  /** `marked`: a car to ring in red (the career rival), -1 for none. */
  draw(ctx: CanvasRenderingContext2D, track: Track, world: World, colors: readonly string[], players: readonly number[], x: number, y: number, w: number, h: number, marked = -1): void {
    const key = `${track.def.id}:${w}x${h}`;
    if (key !== this.key) this.build(track, w, h, key);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.drawImage(this.canvas!, x, y);
    const plot = (id: number, size: number) => {
      const c = world.cars[id];
      const px = Math.round(x + (c.x - this.ox) * this.scale - size / 2);
      const py = Math.round(y + (c.z - this.oz) * this.scale - size / 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(px - 1, py - 1, size + 2, size + 2);
      ctx.fillStyle = colors[id];
      ctx.fillRect(px, py, size, size);
    };
    if (marked >= 0 && world.cars[marked]) {
      const c = world.cars[marked];
      const px = Math.round(x + (c.x - this.ox) * this.scale);
      const py = Math.round(y + (c.z - this.oz) * this.scale);
      ctx.fillStyle = '#ff2b1c';
      ctx.fillRect(px - 4, py - 4, 8, 8);
    }
    for (const c of world.cars) if (!players.includes(c.id) && c.outOrder === 0) plot(c.id, 2);
    for (const id of players) plot(id, 4);
  }

  private build(track: Track, w: number, h: number, key: string): void {
    const b = track.bounds;
    const s = Math.min((w - 4) / (b.maxX - b.minX), (h - 4) / (b.maxZ - b.minZ));
    this.scale = s;
    this.ox = b.minX - (w / s - (b.maxX - b.minX)) / 2;
    this.oz = b.minZ - (h / s - (b.maxZ - b.minZ)) / 2;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= track.n; i += 4) {
        const k = i % track.n;
        const px = (track.px[k] - this.ox) * s;
        const pz = (track.pz[k] - this.oz) * s;
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      }
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    path();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 5;
    ctx.stroke();
    path();
    ctx.strokeStyle = '#c8ccd4';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Start/finish marker.
    const sx = (track.px[0] - this.ox) * s;
    const sz = (track.pz[0] - this.oz) * s;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(sx) - 1, Math.round(sz) - 3, 2, 6);
    // Threshold alpha so the outline stays crisp at low resolution.
    const img = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 100 ? 255 : 0;
    ctx.putImageData(img, 0, 0);
    this.canvas = c;
    this.key = key;
  }
}
