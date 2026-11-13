// Text over the podium scene: banner, names on the cars, places on the steps.

import { drawText } from '../font.ts';
import { ordinal } from './hud.ts';

export interface PodiumTag {
  name: string;
  local: boolean;
  /** 0 = 1st. */
  place: number;
  /** Screen points (UI pixels) over the car and on the front of its step. */
  headX: number;
  headY: number;
  frontX: number;
  frontY: number;
}

const MEDAL = ['#ffd84a', '#d3dae6', '#cf8a4c'];

/**
 * `mine`: the best finishing place (1-based) of anybody at this screen, or 0
 * for a spectator. `players`: how many people play here (1 or 2).
 * `who`: for two players, which one it was (1 or 2).
 */
export function drawPodiumUi(
  ctx: CanvasRenderingContext2D, W: number, H: number, tags: readonly PodiumTag[], time: number,
  mine: number, players: number, who: number, winner: string, touch: boolean,
): void {
  const small = H < 300;
  const fade = Math.min(1, time / 0.4);
  ctx.globalAlpha = fade;
  // Names over the cars, places on the steps.
  for (const t of tags) {
    const shown = Math.min(1, Math.max(0, (time - (2 - t.place) * 0.22 - 0.3) / 0.3));
    if (shown <= 0) continue;
    ctx.globalAlpha = shown;
    drawText(ctx, t.name, t.headX, t.headY, { align: 'center', color: t.local ? '#ffd84a' : '#ffffff', scale: small ? 1 : 2 });
    if (t.local) drawText(ctx, players > 1 ? 'P' + who : 'YOU', t.headX, t.headY - (small ? 10 : 18), { align: 'center', color: '#ffd84a' });
    drawText(ctx, String(t.place + 1), t.frontX, t.frontY - (small ? 3 : 6), { align: 'center', color: MEDAL[t.place], scale: small ? 2 : 3 });
  }
  ctx.globalAlpha = fade;
  // Banner: the player's own moment, or who won.
  const bigScale = small ? 2 : 4;
  const y = Math.round(H * 0.07);
  if (mine === 1) {
    drawText(ctx, players > 1 ? `PLAYER ${who} WINS!` : 'YOU WIN!', W / 2, y, { align: 'center', color: Math.sin(time * 8) > 0 ? '#ffd84a' : '#ffffff', scale: bigScale });
  } else if (mine > 1 && mine <= 3) {
    drawText(ctx, mine === 2 ? 'SECOND PLACE!' : 'THIRD PLACE!', W / 2, y, { align: 'center', color: MEDAL[mine - 1], scale: bigScale });
    drawText(ctx, `${winner} WINS`, W / 2, y + (small ? 20 : 36), { align: 'center', color: '#ffffff', scale: small ? 1 : 2 });
  } else {
    drawText(ctx, `${winner} WINS`, W / 2, y, { align: 'center', color: '#ffd84a', scale: small ? 2 : 3 });
    if (mine > 3) drawText(ctx, `YOU FINISHED ${ordinal(mine)}`, W / 2, y + (small ? 20 : 30), { align: 'center', color: '#c8d0dc', scale: small ? 1 : 2 });
  }
  ctx.globalAlpha = 1;
  if (Math.sin(time * 5) > -0.2) drawText(ctx, touch ? 'TAP TO CONTINUE' : 'PRESS ENTER TO CONTINUE', W / 2, H - 14, { align: 'center', color: '#c8d0dc' });
}
