// In-race HUD: position, laps, times, speed, start lights, messages and a
// minimap. Drawn per viewport on the low-res UI canvas.

import { DT } from '../../../shared/config/constants.ts';
import type { Track } from '../../../shared/track/types.ts';
import type { World } from '../../../shared/sim/world.ts';
import { RacePhase } from '../../../shared/sim/world.ts';
import { lightsOn } from '../../game/raceView.ts';
import { drawText, textWidth } from '../font.ts';

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
export function drawPlayerHud(ctx: CanvasRenderingContext2D, r: HudRect, world: World, carId: number, label: string | null): void {
  const car = world.cars[carId];
  const race = world.race;
  const x = r.x + 6;
  const practice = race.laps === 0;
  if (!practice) {
    const pos = String(car.place);
    drawText(ctx, pos, x, 6, { scale: 4, color: YELLOW });
    const px = x + textWidth(pos, 4) + 3;
    drawText(ctx, ordinal(car.place).slice(pos.length), px, 6, { scale: 2, color: YELLOW });
    drawText(ctx, `/${world.cars.length}`, px, 22, { color: '#d0d0d0' });
    const lap = Math.max(1, Math.min(race.laps, car.lap));
    drawText(ctx, `LAP ${lap}/${race.laps}`, x, 40, { scale: 2 });
  } else {
    drawText(ctx, 'PRACTICE', x, 6, { scale: 2, color: YELLOW });
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

  if (race.weapons) drawArsenal(ctx, x, r.h - 44, car);
  const grace = race.startTick + 180 - world.tick;
  if (race.weapons && race.phase === RacePhase.Racing && grace > -90 && !practice) {
    const text = grace > 0 ? `WEAPONS IN ${Math.ceil(grace / 60)}` : 'WEAPONS FREE!';
    drawText(ctx, text, r.x + r.w / 2, r.h * 0.22, { scale: 2, color: grace > 0 ? '#c8d0dc' : '#ff6b5e', align: 'center' });
  }

  const kmh = Math.round(Math.hypot(car.vx, car.vz) * 3.6);
  drawText(ctx, `${kmh}`, x, r.h - 22, { scale: 2 });
  drawText(ctx, 'KM/H', x + 4 + String(kmh).length * 12, r.h - 15, { color: '#c0c0c0' });

  const cx = r.x + r.w / 2;
  if (car.finished) {
    drawText(ctx, `FINISHED ${ordinal(race.finishOrder.indexOf(carId) + 1)}!`, cx, r.h * 0.28, { scale: 3, color: YELLOW, align: 'center' });
  } else if (car.wrongWayTicks > 90 && race.phase === RacePhase.Racing) {
    if (Math.floor(world.tick / 15) % 2 === 0) drawText(ctx, 'WRONG WAY!', cx, r.h * 0.3, { scale: 3, color: '#ff4a3a', align: 'center' });
  }
}

/** Missiles, mines and turbos left, and a damage bar. */
function drawArsenal(ctx: CanvasRenderingContext2D, x: number, y: number, car: World['cars'][number]): void {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 13, 112, 24);
  // Damage bar.
  const d = Math.min(1, car.damage);
  drawText(ctx, 'DMG', x, y - 10, { color: '#9aa4b8' });
  ctx.fillStyle = '#222';
  ctx.fillRect(x + 22, y - 10, 82, 6);
  ctx.fillStyle = car.wreckTicks > 0 ? '#ff2b1c' : d < 0.4 ? '#9cff9c' : d < 0.7 ? '#ffd84a' : '#ff6b5e';
  ctx.fillRect(x + 22, y - 10, Math.round(82 * d), 6);
  // Ammo: missile, mine, turbo icons with counts.
  const icon = (ix: number, kind: number, n: number) => {
    const dim = n === 0;
    if (kind === 0) {
      ctx.fillStyle = dim ? '#555' : '#e8e6e0';
      ctx.fillRect(ix, y + 2, 10, 3);
      ctx.fillStyle = dim ? '#444' : '#d42a24';
      ctx.fillRect(ix + 10, y + 2, 2, 3);
      ctx.fillRect(ix, y + 1, 2, 5);
    } else if (kind === 1) {
      ctx.fillStyle = dim ? '#444' : '#2a2c30';
      ctx.fillRect(ix + 1, y + 1, 8, 6);
      ctx.fillStyle = dim ? '#555' : '#ff2b1c';
      ctx.fillRect(ix + 4, y + 2, 2, 2);
    } else {
      ctx.fillStyle = dim ? '#555' : '#6fd0ff';
      ctx.fillRect(ix, y + 2, 8, 3);
      ctx.fillStyle = dim ? '#444' : '#ffffff';
      ctx.fillRect(ix + 8, y + 1, 3, 5);
    }
    drawText(ctx, String(n), ix + 14, y + 1, { color: dim ? '#6a7488' : '#ffffff' });
  };
  icon(x, 0, car.missiles);
  icon(x + 38, 1, car.mines);
  icon(x + 74, 2, car.turbos);
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

  draw(ctx: CanvasRenderingContext2D, track: Track, world: World, colors: readonly string[], players: readonly number[], x: number, y: number, w: number, h: number): void {
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
    for (const c of world.cars) if (!players.includes(c.id)) plot(c.id, 2);
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
