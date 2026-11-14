// HUD weather cue: a small sky icon with a word under the minimap (RAIN,
// RAIN COMING, DRYING...), blinking when it is about to change or just has,
// and a bigger line across the screen when the rain arrives or stops.

import { rainAt, wetnessAt } from '../../shared/sim/weather.ts';
import type { World } from '../../shared/sim/world.ts';
import { drawText, textWidth } from './font.ts';

/** Warn this long before the rain comes (ticks). */
const WARN = 60 * 8;
/** Blink this long after it changes. */
const NEWS = 60 * 5;
/** The line across the screen shows this long. */
const BIG = 60 * 3.5;

type Sky = 'sun' | 'cloud' | 'rain';

/** What to say now ('' = nothing), whether it is news, and the icon. */
export function weatherCue(world: World, snow: boolean): { text: string; news: boolean; sky: Sky } {
  const plan = world.weather;
  if (!plan) return { text: '', news: false, sky: 'sun' };
  const t = world.tick;
  const fall = snow ? 'SNOW' : 'RAIN';
  const wet = wetnessAt(plan, t);
  const rain = rainAt(plan, t);
  if (plan.rainOn > t) {
    const soon = plan.rainOn - t < WARN;
    return { text: soon ? `${fall} SOON` : 'DRY', news: soon, sky: soon ? 'cloud' : 'sun' };
  }
  if (t < plan.rainOff) {
    const news = t - plan.rainOn < NEWS + 60 * 4;
    return { text: wet < 0.9 && plan.rainOn > 0 ? `${fall} - GETTING WET` : `${fall} - ${snow ? 'SLIPPERY' : 'WET TRACK'}`, news: news && plan.rainOn > 0, sky: 'rain' };
  }
  if (wet > 0.05) return { text: rain > 0.05 ? `${fall} EASING` : 'DRYING', news: t - plan.rainOff < NEWS, sky: 'cloud' };
  return { text: 'DRY', news: false, sky: 'sun' };
}

/** Draws the cue centred on x, top at y (W, H: the whole UI), ending left of `right`. */
export function drawWeatherCue(ctx: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, world: World, snow: boolean, right = W - 4): void {
  const cue = weatherCue(world, snow);
  if (!cue.text) return;
  const blink = cue.news && Math.floor(world.tick / 20) % 2 === 0;
  const color = cue.news ? (blink ? '#ffd84a' : '#ffffff') : '#c8d4e4';
  const w = textWidth(cue.text, 1) + 14;
  const x0 = Math.round(Math.max(4, Math.min(right - w, x - w / 2)));
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x0 - 2, y - 1, w + 4, 11);
  drawSky(ctx, x0, y, cue.sky, snow, world.tick);
  drawText(ctx, cue.text, x0 + 13, y + 1, { color });
  // The moment it starts or stops: a line across the middle.
  const plan = world.weather!;
  const on = world.tick - plan.rainOn;
  const off = world.tick - plan.rainOff;
  let big = '';
  if (off >= 0 && off < BIG) big = snow ? 'THE SNOW STOPS' : 'THE RAIN STOPS';
  else if (on >= 0 && on < BIG && plan.rainOn > world.race.startTick) big = snow ? 'IT IS SNOWING!' : 'IT IS RAINING!';
  const age = off >= 0 ? off : on;
  // Steady at first, then blinking away.
  if (big && (age < 120 || Math.floor(age / 15) % 2 === 0)) drawText(ctx, big, W / 2, Math.round(H * 0.3), { scale: 2, color: '#9fd8ff', align: 'center' });
}

/** A 10x9 pixel sky: sun, cloud, or cloud with rain or snow. */
function drawSky(ctx: CanvasRenderingContext2D, x: number, y: number, sky: Sky, snow: boolean, tick: number): void {
  if (sky === 'sun') {
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(x + 3, y + 2, 4, 4);
    ctx.fillRect(x + 4, y, 2, 1);
    ctx.fillRect(x + 4, y + 7, 2, 1);
    ctx.fillRect(x + 1, y + 3, 1, 2);
    ctx.fillRect(x + 8, y + 3, 1, 2);
    return;
  }
  ctx.fillStyle = sky === 'rain' ? '#9aa4b4' : '#d0d6e0';
  ctx.fillRect(x + 1, y + 2, 8, 3);
  ctx.fillRect(x + 3, y + 1, 4, 1);
  if (sky !== 'rain') return;
  ctx.fillStyle = snow ? '#ffffff' : '#6fb4ff';
  const f = Math.floor(tick / 8) % 2;
  for (let k = 0; k < 3; k++) ctx.fillRect(x + 2 + k * 3 - (snow ? 0 : f), y + 6 + ((k + f) % 2), 1, snow ? 1 : 2);
}
