// Records: per track, your own best lap and race times, and the world's top
// ten verified laps. Left/right (or a tap on either side) switches track;
// up/down picks a lap on the world board and ENTER (or a tap on it) races
// its ghost in a time trial.

import { DT } from '../../../shared/config/constants.ts';
import { boardKey, LEAGUE_NAMES, type League } from '../../../shared/game/leagues.ts';
import { MEDAL_COLORS, MEDAL_NAMES, medalTimes } from '../../../shared/game/medals.ts';
import type { Boards, RecordEntry } from '../../../shared/game/records.ts';
import { TRACK_LIST } from '../../../shared/track/defs/index.ts';
import type { NavState } from '../../input/nav.ts';
import { fetchBoards, loadLocalRecords, trackRecords } from '../../game/records.ts';
import { loadMedals, medalOf } from '../../game/medals.ts';
import { drawText, textWidth } from '../font.ts';
import { formatTime } from './hud.ts';

export class RecordsScreen {
  index = 0;
  private boards: Boards | null = null;
  private loading = false;
  private failed = false;
  /** Your name on the boards (highlighted). */
  me = '';
  /** Boards of this league. */
  league: League = 'standard';
  /** Race the ghost of a board entry (time trial). */
  onRace: ((track: string, league: League, entry: RecordEntry, rank: number) => void) | null = null;
  /** Chosen entry on the world board. */
  private sel = 0;
  /** Where the world board's rows were drawn (UI pixels). */
  private rows: { y: number; h: number; x: number; w: number }[] = [];
  private readonly onBack: () => void;
  private readonly onMove: () => void;
  private W = 1;

  constructor(onBack: () => void, onMove: () => void) {
    this.onBack = onBack;
    this.onMove = onMove;
  }

  /** Open on a track and fetch the latest boards. */
  open(track: string, league: League = 'standard'): void {
    this.league = league;
    this.sel = 0;
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
    const board = this.board();
    const racing = !!this.onRace && board.length > 0;
    if (racing && (nav.up || nav.down)) {
      this.sel = (this.sel + (nav.up ? -1 : 1) + board.length) % board.length;
      this.onMove();
      return;
    }
    if (racing && nav.click) {
      const row = this.rows.findIndex((r) => nav.pointerX >= r.x && nav.pointerX < r.x + r.w && nav.pointerY >= r.y && nav.pointerY < r.y + r.h);
      if (row >= 0 && row !== this.sel) {
        this.sel = row;
        this.onMove();
        return;
      }
      if (row >= 0) {
        this.race(board);
        return;
      }
    }
    if (racing && nav.confirm && board[this.sel]?.id) {
      this.race(board);
      return;
    }
    let d = nav.left || nav.up ? -1 : nav.right || nav.down ? 1 : 0;
    if (nav.click) d = nav.pointerX < this.W / 2 ? -1 : 1;
    if (nav.confirm) d = 1;
    if (d) {
      this.index = (this.index + d + TRACK_LIST.length) % TRACK_LIST.length;
      this.sel = 0;
      this.onMove();
    }
  }

  private board(): RecordEntry[] {
    return this.boards?.[boardKey(TRACK_LIST[this.index].id, this.league)] ?? [];
  }

  private race(board: RecordEntry[]): void {
    const e = board[this.sel];
    if (e?.id) this.onRace?.(TRACK_LIST[this.index].id, this.league, e, this.sel + 1);
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
    drawText(ctx, this.league === 'standard' ? 'RECORDS' : `RECORDS - ${LEAGUE_NAMES[this.league]}`, W / 2, y, { scale: 2, color: '#ffd84a', align: 'center' });
    y += short ? 22 : 26;
    drawText(ctx, `←  ${def.name.toUpperCase()}  →`, W / 2, y, { scale: 2, color: '#ffffff', align: 'center' });
    y += short ? 22 : 28;

    // The medal laps of this track and league, the ones you have won lit up.
    const times = medalTimes(def.id, this.league);
    const won = medalOf(loadMedals(), def.id, this.league);
    if (times) {
      const parts = ([3, 2, 1] as const).map((m) => {
        const ticks = m === 3 ? times.gold : m === 2 ? times.silver : times.bronze;
        return { m, text: `${won >= m ? '■' : '□'} ${MEDAL_NAMES[m]} ${formatTime(ticks * DT)}` };
      });
      const gap = 14 * k;
      let x = Math.round(W / 2 - (parts.reduce((a, p) => a + textWidth(p.text, k), 0) + gap * 2) / 2);
      for (const p of parts) {
        drawText(ctx, p.text, x, y, { color: won >= p.m ? MEDAL_COLORS[p.m] : '#6a7488', scale: k });
        x += textWidth(p.text, k) + gap;
      }
      y += short ? 13 : 10 * k + 8;
    }

    // Your records.
    const key = boardKey(def.id, this.league);
    const mine = trackRecords(loadLocalRecords(), key);
    const left = Math.round(W / 2 - (short ? 150 : 200 * k));
    const right = Math.round(W / 2 + (short ? 10 : 20 * k));
    drawText(ctx, 'YOUR BEST', left, y, { color: '#9fd8ff', scale: k });
    drawText(ctx, 'WORLD TOP 10 - BEST LAP', right, y, { color: '#9fd8ff', scale: k });
    let ly = y + line + 3;
    drawText(ctx, `LAP   ${mine.lap ? formatTime(mine.lap * DT) : '-'}`, left, ly, { color: '#ffffff', scale: k });
    if (won) drawText(ctx, MEDAL_NAMES[won], left + textWidth('LAP   0:00.00  ', k), ly, { color: MEDAL_COLORS[won], scale: k });
    ly += line;
    const races = Object.keys(mine.race).map(Number).sort((a, b) => a - b);
    for (const laps of races) {
      drawText(ctx, `${laps} LAP${laps > 1 ? 'S' : ' '} ${formatTime(mine.race[laps] * DT)}`, left, ly, { color: '#c8d0dc', scale: k });
      ly += line;
    }
    if (!races.length) drawText(ctx, 'NO RACES FINISHED YET', left, ly, { color: '#6a7488', scale: k });

    // The world board.
    let wy = y + line + 3;
    const board = this.boards?.[key] ?? [];
    if (this.loading && !this.boards) drawText(ctx, 'LOADING...', right, wy, { color: '#8090a8', scale: k });
    else if (this.failed && !this.boards) drawText(ctx, 'CANNOT REACH THE SERVER', right, wy, { color: '#ff6b5e', scale: k });
    else if (!board.length) drawText(ctx, 'NO RECORDS YET - BE THE FIRST!', right, wy, { color: '#8090a8', scale: k });
    this.sel = Math.min(this.sel, Math.max(0, board.length - 1));
    this.rows = [];
    const rowH = short ? 10 : line;
    const racing = !!this.onRace && board.length > 0;
    board.forEach((e, i) => {
      const you = e.name === this.me;
      const color = you ? '#ffd84a' : i === 0 ? '#ffffff' : '#c8d0dc';
      const text = `${String(i + 1).padStart(2)}. ${e.name.padEnd(12)} ${formatTime(e.ticks * DT)}`;
      if (racing && i === this.sel) {
        ctx.fillStyle = 'rgba(255,216,74,0.18)';
        ctx.fillRect(right - 3, wy - 2, textWidth(text, k) + 6, rowH);
        drawText(ctx, '>', right - 4 - 6 * k, wy, { color: '#ffd84a', scale: k });
      }
      drawText(ctx, text, right, wy, { color, scale: k });
      this.rows.push({ x: right - 4, y: wy - 2, w: textWidth(text, k) + 8, h: rowH });
      wy += rowH;
    });

    drawText(ctx, 'LAPS FROM QUICK RACES, PRACTICE AND TIME TRIALS, CHECKED BY THE SERVER - BEAT YOUR BEST TO SEND IT', W / 2, H - 22, { color: '#8090a8', align: 'center' });
    const keys = racing ? '←→ TRACK   ↑↓ PICK A LAP   ENTER RACE ITS GHOST   ESC BACK' : '←→ TRACK   ESC BACK';
    drawText(ctx, keys, W / 2, H - 11, { color: '#8090a8', align: 'center' });
  }
}
