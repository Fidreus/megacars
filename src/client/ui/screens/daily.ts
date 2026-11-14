// DAILY CHALLENGE page: today's track, league and time of day, the time left,
// your streak, your best today and place, the day's board and yesterday's
// top three, with START and your name for the board underneath.

import { DT } from '../../../shared/config/constants.ts';
import { dailyPlace, DAILY_BOARD_SIZE, type DailyEntry } from '../../../shared/game/daily.ts';
import { LEAGUE_NAMES } from '../../../shared/game/leagues.ts';
import { trackName } from '../../../shared/track/defs/index.ts';
import { dayName, MOOD_NAMES, type DailyInfo } from '../../game/daily.ts';
import { drawText, textWidth } from '../font.ts';
import type { Menu } from '../menu.ts';
import { formatTime } from './hud.ts';

const YELLOW = '#ffd84a';
const GREY = '#8090a8';
const MOOD_COLORS: Record<string, string> = { day: '#ffe9a8', sunset: '#ff9a5a', night: '#8fa8ff' };

/** "5H 12M", "12M 03S" */
function left(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}H ${String(m).padStart(2, '0')}M` : `${m}M ${String(s % 60).padStart(2, '0')}S`;
}

export function drawDaily(ctx: CanvasRenderingContext2D, W: number, H: number, dt: number, info: DailyInfo, me: string, menu: Menu, time: number, touch: boolean): void {
  info.poll();
  ctx.fillStyle = 'rgba(6,8,20,0.8)';
  ctx.fillRect(0, 0, W, H);
  const ch = info.challenge();
  const big = H >= 330 && W >= 600;
  const k = H >= 460 && W >= 900 ? 2 : 1;
  const line = 10 * k + 1;
  const cx = Math.round(W / 2);
  let y = Math.round(H * (big ? 0.04 : 0.025));

  drawText(ctx, 'DAILY CHALLENGE', cx, y, { scale: 2, color: YELLOW, align: 'center' });
  y += 18;
  drawText(ctx, `${dayName(ch.day)} - NEW CHALLENGE IN ${left(info.timeLeft())}`, cx, y, { color: GREY, align: 'center' });
  y += 13;
  // The challenge itself, big.
  const what = `${trackName(ch.track).toUpperCase()}`;
  const how = `${LEAGUE_NAMES[ch.league]} - ${MOOD_NAMES[ch.mood] ?? ch.mood}`;
  if (big) {
    drawText(ctx, what, cx, y, { scale: 3, color: '#ffffff', align: 'center' });
    y += 25;
    drawText(ctx, how, cx, y, { scale: 2, color: MOOD_COLORS[ch.mood] ?? '#ffffff', align: 'center' });
    y += 20;
  } else {
    const w1 = textWidth(what, 2);
    const w2 = textWidth(`  ${how}`, 1);
    const x0 = Math.round(cx - (w1 + w2) / 2);
    drawText(ctx, what, x0, y, { scale: 2, color: '#ffffff' });
    drawText(ctx, `  ${how}`, x0 + w1, y + 4, { color: MOOD_COLORS[ch.mood] ?? '#ffffff' });
    y += 18;
  }
  drawText(ctx, 'ALONE - STOCK CAR - NO WEAPONS - BEST LAP COUNTS', cx, y, { color: '#c8d0dc', align: 'center' });
  y += 13;

  // The streak: the reason to come back tomorrow.
  const st = info.streak();
  const flash = Math.sin(time * 5) > -0.2;
  const streakText = st.days === 1 ? 'STREAK: 1 DAY' : `STREAK: ${st.days} DAYS`;
  let status: string;
  let statusColor: string;
  if (st.today) {
    status = "TODAY'S LAP IS IN - SEE YOU TOMORROW";
    statusColor = '#5aff6a';
  } else if (st.days) {
    status = 'NO LAP TODAY YET - DRIVE ONE TO KEEP YOUR STREAK!';
    statusColor = flash ? '#ff6b5e' : YELLOW;
  } else {
    status = 'SET A LAP TODAY TO START A STREAK';
    statusColor = YELLOW;
  }
  const sw = Math.max(textWidth(streakText, 2), textWidth(status)) + 16;
  ctx.fillStyle = st.today ? 'rgba(40,120,60,0.35)' : 'rgba(120,40,30,0.35)';
  ctx.fillRect(Math.round(cx - sw / 2), y - 3, Math.round(sw), 30);
  drawText(ctx, streakText, cx, y, { scale: 2, color: st.days ? '#ffb347' : '#c8d0dc', align: 'center' });
  drawText(ctx, status, cx, y + 17, { color: statusColor, align: 'center' });
  y += 35;

  // Menu at the bottom; the two columns fill what is between.
  const scale = H >= 300 ? 2 : 1;
  const rows = menu.items.length;
  const menuTop = H - 14 - rows * (9 * scale + 4) - 4;
  const bottom = menuTop - 12;
  const colW = Math.min(Math.round(W / 2) - 16, 26 * 6 * k);
  const lx = Math.round(cx - colW - 10);
  const rx = Math.round(cx + 10);

  // Left: today's board.
  const board = info.board();
  drawText(ctx, info.online ? `TODAY'S BOARD (${board.length})` : "TODAY'S BOARD", lx, y, { color: '#9fd8ff', scale: k });
  let ly = y + line + 2;
  if (!info.online) {
    if (info.loading) drawText(ctx, 'LOADING...', lx, ly, { color: GREY, scale: k });
    else {
      drawText(ctx, 'BOARD UNAVAILABLE -', lx, ly, { color: '#ff6b5e', scale: k });
      drawText(ctx, 'NO CONNECTION TO THE SERVER.', lx, ly + line, { color: '#ff6b5e', scale: k });
      drawText(ctx, 'YOU CAN STILL DRIVE IT.', lx, ly + line * 2, { color: '#c8d0dc', scale: k });
    }
  } else if (!board.length) {
    drawText(ctx, 'NOBODY YET - BE THE FIRST!', lx, ly, { color: GREY, scale: k });
  } else {
    const fit = Math.max(1, Math.floor((bottom - ly) / line));
    const mine = board.findIndex((e) => e.name === me);
    // Your row stays in view at the end when you are further down.
    const shown = mine >= fit ? fit - 1 : fit;
    const row = (e: DailyEntry, i: number) => {
      const color = e.name === me ? YELLOW : i === 0 ? '#ffffff' : '#c8d0dc';
      drawText(ctx, `${String(i + 1).padStart(2)}. ${e.name.padEnd(12)} ${formatTime(e.ticks * DT)}`, lx, ly, { color, scale: k });
      ly += line;
    };
    board.slice(0, shown).forEach(row);
    if (mine >= shown) row(board[mine], mine);
  }

  // Right: you today, then yesterday.
  let ry = y;
  drawText(ctx, 'YOU TODAY', rx, ry, { color: '#9fd8ff', scale: k });
  ry += line + 2;
  const best = info.myBest();
  if (best) {
    drawText(ctx, `BEST LAP ${formatTime(best * DT)}`, rx, ry, { color: '#9cff9c', scale: k });
    ry += line;
    if (info.online) {
      // The board has the lap as the server measured it.
      const mine = board.findIndex((e) => e.name === me);
      if (mine >= 0) {
        const e = board[mine];
        const text = e.ticks === best ? `PLACE #${mine + 1} OF ${board.length}` : `ON THE BOARD: #${mine + 1} ${formatTime(e.ticks * DT)}`;
        drawText(ctx, text, rx, ry, { color: mine === 0 ? '#5aff6a' : YELLOW, scale: k });
      } else {
        const p = dailyPlace(board, me, best);
        drawText(ctx, p > DAILY_BOARD_SIZE ? 'OUTSIDE THE TOP 50' : 'NOT ON THE BOARD YET', rx, ry, { color: GREY, scale: k });
      }
      ry += line;
    }
  } else {
    drawText(ctx, 'NO LAP YET', rx, ry, { color: GREY, scale: k });
    ry += line;
  }
  if (info.online && board[0] && board[0].name !== me) {
    drawText(ctx, `TO BEAT: ${formatTime(board[0].ticks * DT)}`, rx, ry, { color: '#c8d0dc', scale: k });
    ry += line;
  }
  ry += 6;
  const yd = info.yesterday();
  if (ry + line * 2 < bottom) {
    if (yd) {
      const yc = yd.challenge;
      drawText(ctx, `YESTERDAY: ${trackName(yc.track).toUpperCase()}`, rx, ry, { color: '#9fd8ff', scale: k });
      ry += line;
      drawText(ctx, `${LEAGUE_NAMES[yc.league]} - ${MOOD_NAMES[yc.mood] ?? yc.mood}`, rx, ry, { color: GREY, scale: k });
      ry += line + 1;
      yd.top.forEach((e, i) => {
        if (ry + line > bottom) return;
        drawText(ctx, `${i + 1}. ${e.name.padEnd(12)} ${formatTime(e.ticks * DT)}`, rx, ry, { color: ['#ffd84a', '#d8dce6', '#e0a070'][i], scale: k });
        ry += line;
      });
    } else if (info.online) {
      drawText(ctx, 'YESTERDAY: NO LAPS', rx, ry, { color: GREY, scale: k });
    }
  }

  menu.draw(ctx, cx, menuTop, scale, dt, true, H - 14);
  drawText(ctx, touch ? 'TAP START - TAP THE NAME TO TYPE' : 'ENTER SELECT   TYPE YOUR NAME   ESC BACK', cx, H - 11, { color: GREY, align: 'center' });
}
