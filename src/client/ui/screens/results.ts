// End-of-race results table.

import { DT } from '../../../shared/config/constants.ts';
import { standings, type World } from '../../../shared/sim/world.ts';
import { drawText } from '../font.ts';
import { elimResult } from './elimHud.ts';
import { formatTime, ordinal } from './hud.ts';

export function drawResults(
  ctx: CanvasRenderingContext2D, W: number, H: number, world: World, names: readonly string[], colors: readonly string[], players: readonly number[], time: number,
): void {
  const order = standings(world);
  const rowH = 12;
  const boxW = Math.min(W - 20, 300);
  const boxH = 46 + order.length * rowH + 22;
  const x0 = Math.round(W / 2 - boxW / 2);
  const y0 = Math.round(H / 2 - boxH / 2);
  ctx.fillStyle = 'rgba(8,10,24,0.86)';
  ctx.fillRect(x0, y0, boxW, boxH);
  ctx.fillStyle = '#ffd84a';
  ctx.fillRect(x0, y0, boxW, 2);
  ctx.fillRect(x0, y0 + boxH - 2, boxW, 2);
  drawText(ctx, world.elim ? 'ELIMINATION RESULTS' : 'RACE RESULTS', W / 2, y0 + 10, { scale: 2, color: '#ffd84a', align: 'center' });
  drawText(ctx, 'POS', x0 + 10, y0 + 32, { color: '#8090a8' });
  drawText(ctx, 'DRIVER', x0 + 46, y0 + 32, { color: '#8090a8' });
  drawText(ctx, world.elim ? 'OUT' : 'TIME', x0 + boxW - 92, y0 + 32, { color: '#8090a8', align: 'right' });
  drawText(ctx, 'BEST LAP', x0 + boxW - 10, y0 + 32, { color: '#8090a8', align: 'right' });
  const race = world.race;
  order.forEach((id, i) => {
    const c = world.cars[id];
    const y = y0 + 46 + i * rowH;
    const me = players.includes(id);
    if (me) {
      ctx.fillStyle = 'rgba(255,216,74,0.18)';
      ctx.fillRect(x0 + 4, y - 2, boxW - 8, rowH);
    }
    drawText(ctx, ordinal(i + 1), x0 + 10, y, { color: i === 0 ? '#ffd84a' : '#ffffff' });
    ctx.fillStyle = colors[id];
    ctx.fillRect(x0 + 36, y, 6, 7);
    drawText(ctx, names[id], x0 + 46, y, { color: me ? '#ffd84a' : '#ffffff' });
    const total = elimResult(world, id) ?? (c.finished ? formatTime((c.finishTick - race.startTick) * DT) : 'DNF');
    drawText(ctx, total, x0 + boxW - 92, y, { align: 'right' });
    drawText(ctx, c.bestLapTicks ? formatTime(c.bestLapTicks * DT) : '-', x0 + boxW - 10, y, { align: 'right', color: '#9cff9c' });
  });
  if (Math.sin(time * 5) > -0.2) drawText(ctx, 'PRESS ENTER TO CONTINUE', W / 2, y0 + boxH - 14, { color: '#c8d0dc', align: 'center' });
}
