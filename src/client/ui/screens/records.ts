// Records: per track, your own best lap and race times, and the world's top
// ten verified laps. Left/right (or a tap on either side) switches track.

import { DT } from '../../../shared/config/constants.ts';
import type { Boards } from '../../../shared/game/records.ts';
import { TRACK_LIST } from '../../../shared/track/defs/index.ts';
import type { NavState } from '../../input/nav.ts';
import { fetchBoards, loadLocalRecords, trackRecords } from '../../game/records.ts';
import { drawText } from '../font.ts';
import { formatTime } from './hud.ts';

export class RecordsScreen {
  index = 0;
  private boards: Boards | null = null;
  private loading = false;
  private failed = false;
  /** Your name on the boards (highlighted). */
  me = '';
  private readonly onBack: () => void;
  private readonly onMove: () => void;
  private W = 1;

  constructor(onBack: () => void, onMove: () => void) {
    this.onBack = onBack;
    this.onMove = onMove;
  }

  /** Open on a track and fetch the latest boards. */
  open(track: string): void {
    this.index = Math.max(0, TRACK_LIST.findIndex((t) => t.id === track));
    this.loading = true;
    this.failed = false;
    void fetchBoards().then((b) => {
      this.boards = b ?? this.boards;
      this.failed = !b;
      this.loading = false;
    });
  }

  handle(nav: NavState): void {
    if (nav.back) {
      this.onBack();
      return;
    }
    let d = nav.left || nav.up ? -1 : nav.right || nav.down ? 1 : 0;
    if (nav.click) d = nav.pointerX < this.W / 2 ? -1 : 1;
    if (nav.confirm) d = 1;
    if (d) {
      this.index = (this.index + d + TRACK_LIST.length) % TRACK_LIST.length;
      this.onMove();
    }
  }

  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    this.W = W;
    ctx.fillStyle = 'rgba(6,8,20,0.8)';
    ctx.fillRect(0, 0, W, H);
    const def = TRACK_LIST[this.index];
    const short = H < 320;
    // Big text when the screen has room for it.
    const k = H >= 420 && W >= 760 ? 2 : 1;
    const line = 10 * k + 1;
    let y = Math.round(H * 0.05);
    drawText(ctx, 'RECORDS', W / 2, y, { scale: 2, color: '#ffd84a', align: 'center' });
    y += short ? 22 : 26;
    drawText(ctx, `←  ${def.name.toUpperCase()}  →`, W / 2, y, { scale: 2, color: '#ffffff', align: 'center' });
    y += short ? 22 : 28;

    // Your records.
    const mine = trackRecords(loadLocalRecords(), def.id);
    const left = Math.round(W / 2 - (short ? 150 : 200 * k));
    const right = Math.round(W / 2 + (short ? 10 : 20 * k));
    drawText(ctx, 'YOUR BEST', left, y, { color: '#9fd8ff', scale: k });
    drawText(ctx, 'WORLD TOP 10 - BEST LAP', right, y, { color: '#9fd8ff', scale: k });
    let ly = y + line + 3;
    drawText(ctx, `LAP   ${mine.lap ? formatTime(mine.lap * DT) : '-'}`, left, ly, { color: '#ffffff', scale: k });
    ly += line;
    const races = Object.keys(mine.race).map(Number).sort((a, b) => a - b);
    for (const laps of races) {
      drawText(ctx, `${laps} LAP${laps > 1 ? 'S' : ' '} ${formatTime(mine.race[laps] * DT)}`, left, ly, { color: '#c8d0dc', scale: k });
      ly += line;
    }
    if (!races.length) drawText(ctx, 'NO RACES FINISHED YET', left, ly, { color: '#6a7488', scale: k });

    // The world board.
    let wy = y + line + 3;
    const board = this.boards?.[def.id] ?? [];
    if (this.loading && !this.boards) drawText(ctx, 'LOADING...', right, wy, { color: '#8090a8', scale: k });
    else if (this.failed && !this.boards) drawText(ctx, 'CANNOT REACH THE SERVER', right, wy, { color: '#ff6b5e', scale: k });
    else if (!board.length) drawText(ctx, 'NO RECORDS YET - BE THE FIRST!', right, wy, { color: '#8090a8', scale: k });
    board.forEach((e, i) => {
      const you = e.name === this.me;
      const color = you ? '#ffd84a' : i === 0 ? '#ffffff' : '#c8d0dc';
      drawText(ctx, `${String(i + 1).padStart(2)}. ${e.name.padEnd(12)} ${formatTime(e.ticks * DT)}`, right, wy, { color, scale: k });
      wy += short ? 10 : line;
    });

    drawText(ctx, 'LAPS FROM QUICK RACES AND PRACTICE, CHECKED BY THE SERVER - BEAT YOUR BEST TO SEND IT', W / 2, H - 22, { color: '#8090a8', align: 'center' });
    drawText(ctx, '←→ TRACK   ESC BACK', W / 2, H - 11, { color: '#8090a8', align: 'center' });
  }
}
