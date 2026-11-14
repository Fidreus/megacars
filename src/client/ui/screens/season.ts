// End of a career season: where you finished, the bonus, and what it means.

import type { Career } from '../../game/career.ts';
import { drawText } from '../font.ts';
import { ordinal } from './hud.ts';
import { driverNotes, rivalOf } from '../../game/rival.ts';

/** The rival duel just decided, and who to beat next season. */
function drawDuel(g: CanvasRenderingContext2D, W: number, y: number, c: Career): number {
  const d = c.last?.rival;
  if (d) {
    const score = `${d.ahead}-${d.behind} IN RACES, ${d.gap === 0 ? 'LEVEL ON POINTS' : `${Math.abs(d.gap)} PTS ${d.gap > 0 ? 'AHEAD' : 'BEHIND'}`}`;
    drawText(g, d.won ? `YOU BEAT YOUR RIVAL ${d.name}!` : `${d.name} WON THE RIVAL DUEL`, W / 2, y, { color: d.won ? '#9cff9c' : '#ff6b5e', align: 'center' });
    y += 11;
    drawText(g, d.won ? `${score} - RIVAL BONUS $${d.bonus}` : score, W / 2, y, { color: '#c8d0dc', align: 'center' });
    y += 14;
  }
  const next = rivalOf(c.cup);
  if (next) {
    drawText(g, `NEXT RIVAL: ${next.name} - ${driverNotes(next).blurb ?? ''}`, W / 2, y, { color: '#ff9a8a', align: 'center' });
    y += 12;
  }
  return y + 4;
}

const HEADLINES = {
  promoted: (d: number) => [`PROMOTED TO DIVISION ${d}!`, '#9cff9c'],
  stayed: (d: number) => [`ANOTHER SEASON IN DIVISION ${d}`, '#ffd84a'],
  champion: () => ['MEGACARS CHAMPION!', '#ffd84a'],
  defended: () => ['TITLE DEFENDED!', '#ffd84a'],
  lost: () => ['TITLE LOST - TRY AGAIN', '#ff6b5e'],
} as const;

export function drawSeasonEnd(g: CanvasRenderingContext2D, W: number, H: number, c: Career, time: number, touch = false): void {
  const r = c.last!;
  g.fillStyle = 'rgba(8,10,24,0.82)';
  g.fillRect(0, 0, W, H);
  const [head, color] = HEADLINES[r.outcome](c.division);
  const big = W >= 560 ? 3 : 2;
  let y = Math.round(H * 0.22);
  drawText(g, `SEASON ${c.season - 1} - DIVISION ${r.division}`, W / 2, y, { color: '#9fd8ff', align: 'center', scale: 2 });
  y += 30;
  // A little bounce on the headline.
  const bob = Math.round(Math.sin(time * 4) * 2);
  drawText(g, head, W / 2, y + bob, { scale: big, color, align: 'center' });
  y += 7 * big + 22;
  drawText(g, `YOU FINISHED ${ordinal(r.place)}`, W / 2, y, { scale: 2, align: 'center' });
  y += 24;
  if (r.bonus > 0) drawText(g, `SEASON BONUS $${r.bonus}`, W / 2, y, { scale: 2, color: '#9cff9c', align: 'center' });
  y += 22;
  y = drawDuel(g, W, y, c);
  const next = r.outcome === 'champion' || r.outcome === 'defended'
    ? `TITLES: ${c.titles}. DEFEND IT IN DIVISION 1!`
    : `NEXT: DIVISION ${c.division}${c.division > 1 ? ' - FINISH TOP 3 TO MOVE UP' : ' - WIN IT TO BE CHAMPION'}`;
  drawText(g, next, W / 2, y, { color: '#c8d0dc', align: 'center' });
  if (Math.sin(time * 5) > -0.2) drawText(g, touch ? 'TAP TO CONTINUE' : 'PRESS ENTER', W / 2, H - 30, { color: '#c8d0dc', align: 'center' });
}
