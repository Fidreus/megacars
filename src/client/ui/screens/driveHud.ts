// HUD next to the speed readout: the drift charge meter (three segments in
// the level colours) and a DRAFT cue while in another car's slipstream.

import { DRIFT_BOOST, driftLevel } from '../../../shared/sim/driftBoost.ts';
import type { CarState } from '../../../shared/sim/car.ts';
import { drawText, textWidth } from '../font.ts';

/** Level colours: blue, orange, purple (also used for sparks and flames). */
export const DRIFT_COLORS = ['#5a6478', '#5ab4ff', '#ffa02a', '#d65aff'];

const SEG_W = 11;
const SEG_H = 5;
const GAP = 2;

/** Width the meter takes. */
export const DRIVE_METER_W = 3 * SEG_W + 2 * GAP;

/** Draw the meter with its top-left at (x, y): segments on y + 4, the level and the DRAFT cue to the right. */
export function drawDriveMeter(ctx: CanvasRenderingContext2D, x: number, y: number, car: CarState, tick: number): void {
  if (car.wreckTicks > 0) return;
  const charge = car.driftCharge;
  const level = driftLevel(charge);
  const boosting = car.driftBoostTicks > 0;
  const lv = DRIFT_BOOST.levels;
  const sy = y + 4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - 2, sy - 2, DRIVE_METER_W + 4, SEG_H + 4);
  for (let k = 0; k < 3; k++) {
    const sx = x + k * (SEG_W + GAP);
    const from = k === 0 ? 0 : lv[k - 1];
    const fill = Math.max(0, Math.min(1, (charge - from) / (lv[k] - from)));
    ctx.fillStyle = '#222630';
    ctx.fillRect(sx, sy, SEG_W, SEG_H);
    // While a boost burns, its segments flash in its colour.
    if (boosting && k < car.driftBoostLevel) {
      ctx.fillStyle = (tick >> 2) % 2 === 0 ? DRIFT_COLORS[car.driftBoostLevel] : '#ffffff';
      ctx.fillRect(sx, sy, SEG_W, SEG_H);
    } else if (fill > 0) {
      ctx.fillStyle = fill >= 1 ? DRIFT_COLORS[k + 1] : DRIFT_COLORS[0];
      ctx.fillRect(sx, sy, Math.max(1, Math.round(SEG_W * fill)), SEG_H);
    }
  }
  if (level > 0 && !boosting) drawText(ctx, `${level}`, x + DRIVE_METER_W + 4, sy - 1, { color: DRIFT_COLORS[level] });
  if (car.draft > 0.15) {
    const on = car.draft >= 1 || (tick >> 3) % 2 === 0;
    const label = 'DRAFT';
    const lx = x + DRIVE_METER_W + 13;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(lx - 2, sy - 2, textWidth(label) + 4, SEG_H + 4);
    drawText(ctx, label, lx, sy - 1, { color: on ? '#9cf0ff' : '#4a7c88' });
  }
}
