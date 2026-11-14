// The daily challenge in the browser. Today's challenge and board come from
// the server (its clock decides the day); offline the challenge is worked
// out here from the date and can still be driven. Your best lap of each day
// and your streak (days in a row with a lap) are kept in this browser.

import { DT } from '../../shared/config/constants.ts';
import {
  addDays, dailyChallenge, dailyPlace, dayNumber, dayOf, insertDaily, nextDayStart,
  type DailyChallenge, type DailyEntry, type DailyResult, type DailySubmission, type DailyView,
} from '../../shared/game/daily.ts';
import { boardKey, LEAGUE_NAMES } from '../../shared/game/leagues.ts';
import { drawText } from '../ui/font.ts';
import { formatTime } from '../ui/screens/hud.ts';
import type { TimeTrialOptions } from './timeTrial.ts';

const KEY = 'megacars.daily.v1';
/** Days of your own bests kept (more than any streak shown needs to see back). */
const KEEP_DAYS = 400;

/** Your best lap (ticks) of each day you drove the challenge. */
export type DailyLog = Record<string, number>;

export function loadDailyLog(): DailyLog {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { laps?: DailyLog };
    const out: DailyLog = {};
    for (const [day, t] of Object.entries(raw.laps ?? {})) if (Number.isFinite(dayNumber(day)) && Number.isInteger(t) && t > 0) out[day] = t;
    return out;
  } catch {
    return {};
  }
}

function saveDailyLog(log: DailyLog, today: string): void {
  const oldest = dayNumber(today) - KEEP_DAYS;
  for (const day of Object.keys(log)) if (dayNumber(day) < oldest) delete log[day];
  try {
    localStorage.setItem(KEY, JSON.stringify({ laps: log }));
  } catch {
    // Kept for this visit only.
  }
}

/** A lap in the challenge of `day`: true if it is your best of that day. */
export function noteDailyLap(log: DailyLog, day: string, ticks: number): boolean {
  if (log[day] && log[day] <= ticks) return false;
  log[day] = ticks;
  saveDailyLog(log, day);
  return true;
}

/**
 * Days in a row with a lap, up to today. Without a lap today yet the streak
 * still stands until midnight (`today` false says it is waiting for one).
 */
export function streakOf(log: DailyLog, today: string): { days: number; today: boolean } {
  const done = !!log[today];
  let day = done ? today : addDays(today, -1);
  let days = 0;
  while (log[day]) {
    days++;
    day = addDays(day, -1);
  }
  return { days, today: done };
}

export const MOOD_NAMES: Record<string, string> = { day: 'DAY', sunset: 'SUNSET', night: 'NIGHT' };

/** "TUE 17 NOV" */
export function dayName(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][d.getUTCDay()];
  const mon = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()];
  return `${wd} ${d.getUTCDate()} ${mon}`;
}

/** Today's challenge and board, from the server when it answers. */
export class DailyInfo {
  view: DailyView | null = null;
  state: 'loading' | 'ok' | 'offline' = 'loading';
  readonly log = loadDailyLog();
  /** The server's clock minus ours. */
  private offset = 0;
  private fetching: Promise<void> | null = null;
  private asked = false;
  /** When the server was last asked (our clock). */
  private fetchedAt = 0;

  /** Fetch once if never asked (the title menu's mark needs the server's day). */
  ensure(): void {
    if (!this.asked) void this.refresh();
  }

  /** Fetch today's challenge and board (again). */
  refresh(): Promise<void> {
    this.asked = true;
    if (!this.fetching) this.fetchedAt = Date.now();
    this.fetching ??= (async () => {
      try {
        const res = await fetch('/api/daily', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const v = (await res.json()) as DailyView;
        if (!v.ok || !v.challenge || !Array.isArray(v.board)) throw new Error('bad answer');
        this.offset = v.now - Date.now();
        this.view = v;
        this.state = 'ok';
      } catch {
        this.state = 'offline';
      } finally {
        this.fetching = null;
      }
    })();
    return this.fetching;
  }

  /** Now by the server's clock (ours when it was never reached). */
  now(): number {
    return Date.now() + this.offset;
  }

  today(): string {
    return dayOf(this.now());
  }

  /** The server's view, if it is still today's. */
  private current(): DailyView | null {
    return this.view && this.view.challenge.day === this.today() ? this.view : null;
  }

  /** While the page is open: a fresh board every 30 s, and at once when the day has turned. */
  poll(): void {
    if (this.fetching) return;
    const stale = this.state === 'ok' && !this.current();
    if (stale || Date.now() - this.fetchedAt > 30_000) void this.refresh();
  }

  /** Waiting for the server (first answer, or a new day's). */
  get loading(): boolean {
    return this.state === 'loading' || (!!this.fetching && !this.current());
  }

  challenge(): DailyChallenge {
    return this.current()?.challenge ?? dailyChallenge(this.today());
  }

  /** Today's board (empty when unknown). */
  board(): DailyEntry[] {
    return this.current()?.board ?? [];
  }

  /** Whether today's board is known (the server answered today). */
  get online(): boolean {
    return this.state === 'ok' && !!this.current();
  }

  yesterday(): DailyView['yesterday'] {
    return this.current()?.yesterday ?? null;
  }

  /** ms until the next challenge. */
  timeLeft(): number {
    return nextDayStart(this.now()) - this.now();
  }

  /** Your best lap of today (ticks), 0 = none. */
  myBest(): number {
    return this.log[this.today()] ?? 0;
  }

  streak(): { days: number; today: boolean } {
    return streakOf(this.log, this.today());
  }

  /** A checked lap of yours, put on the board shown until the next fetch. */
  placeLocally(day: string, name: string, ticks: number): void {
    const v = this.current();
    if (v && v.challenge.day === day) insertDaily(v.board, { name, ticks, at: this.now() });
  }
}

export async function submitDaily(sub: DailySubmission): Promise<DailyResult> {
  try {
    const res = await fetch('/api/daily', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) });
    return (await res.json()) as DailyResult;
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/** The title menu entry: done today (■) or not yet (□), and the streak. */
export function dailyMenuLabel(info: DailyInfo): string {
  info.ensure();
  const s = info.streak();
  if (s.today) return `DAILY CHALLENGE ■ STREAK ${s.days}`;
  return s.days ? `DAILY CHALLENGE □ STREAK ${s.days} - DRIVE TODAY!` : 'DAILY CHALLENGE □ NEW TODAY';
}

/** One run of the challenge: its laps go to the day's board as they are set. */
export class DailyRun {
  readonly challenge: DailyChallenge;
  private readonly info: DailyInfo;
  /** The name on the board. */
  private readonly name: () => string;
  /** Your best of the day when this run began, then as it improves. */
  best: number;
  /** A lap waits to be sent while another is being checked. */
  private next: (() => DailySubmission) | null = null;
  private sending = false;
  /** What happened to the last lap sent (shown on the HUD). */
  note = '';
  noteColor = '#ffd84a';
  /** Place of your best on the server's board, once it answered. */
  place = 0;
  /** Called with a line worth flashing on screen. */
  onNote: ((text: string) => void) | null = null;
  /** A lap was accepted and also went on the world board (the race needn't be sent there again). */
  onWorld: (() => void) | null = null;

  constructor(info: DailyInfo, name: () => string) {
    this.info = info;
    this.challenge = info.challenge();
    this.name = name;
    this.best = info.log[this.challenge.day] ?? 0;
  }

  get day(): string {
    return this.challenge.day;
  }

  /** Storage key of your ghost of the day. */
  get ghostKey(): string {
    return `daily/${this.day}/${boardKey(this.challenge.track, this.challenge.league)}`;
  }

  /** Time trial settings: the day's leader and your own best of the day. */
  ghosts(): Partial<TimeTrialOptions> {
    const leader = this.info.board()[0] ?? null;
    return {
      choice: 'both',
      local: false,
      entry: leader,
      rank: 1,
      mineKey: this.ghostKey,
      worldKey: `${this.ghostKey}/leader`,
      entryLabel: leader ? `DAILY LEADER ${leader.name}` : undefined,
      noEntry: this.info.online ? 'NO DAILY LEADER YET - SET THE FIRST LAP!' : 'OFFLINE - NO LEADER GHOST',
    };
  }

  /** A clean lap: true if it is your best of the day. */
  lap(ticks: number): boolean {
    if (!noteDailyLap(this.info.log, this.day, ticks)) return false;
    this.best = ticks;
    return true;
  }

  /** Send your best of the day (the whole race so far; the server measures it). */
  send(make: () => DailySubmission): void {
    if (this.sending) {
      this.next = make;
      return;
    }
    this.sending = true;
    const sub = make();
    void submitDaily(sub).then((r) => {
      this.sending = false;
      this.result(sub, r);
      const again = this.next;
      this.next = null;
      if (again) this.send(again);
    });
  }

  private result(sub: DailySubmission, r: DailyResult): void {
    const say = (text: string, color = '#ffd84a') => {
      this.note = text;
      this.noteColor = color;
      this.onNote?.(text);
    };
    if (r.ok) {
      if (r.best) this.info.placeLocally(sub.day, sub.name, r.best);
      this.place = r.place ?? 0;
      if (!this.next) this.onWorld?.();
      if (r.rank) say(`DAILY CHALLENGE: #${r.rank} TODAY!${r.worldRank ? ` AND #${r.worldRank} IN THE WORLD` : ''}`);
      else say(this.place ? `LAP CHECKED - YOU ARE #${this.place} TODAY` : 'LAP CHECKED - NOT IN THE TOP 50 YET', '#c8d0dc');
      void this.info.refresh();
    } else if (r.error === 'offline') say('OFFLINE - LAP KEPT ON THIS DEVICE', '#c8d0dc');
    else if (r.error === 'not today') say('THIS CHALLENGE IS OVER - A NEW ONE IS UP', '#ff6b5e');
    else say(`LAP NOT ACCEPTED (${(r.error ?? '').toUpperCase()})`, '#ff6b5e');
  }

  /** The place your best would take on today's board, 0 = no lap yet. */
  wouldPlace(): number {
    if (!this.best) return 0;
    return dailyPlace(this.info.board(), this.name(), this.best);
  }

  /** Under the lap times: which challenge, and where your best stands. */
  draw(ctx: CanvasRenderingContext2D, x: number, top: number): void {
    const ch = this.challenge;
    drawText(ctx, `${LEAGUE_NAMES[ch.league]} - ${MOOD_NAMES[ch.mood] ?? ''}`, x, top, { color: '#9fd8ff' });
    let y = top + 11;
    if (!this.best) {
      drawText(ctx, 'SET A LAP FOR THE BOARD', x, y, { color: '#c8d0dc' });
      return;
    }
    if (this.info.online) {
      const p = this.wouldPlace();
      const board = this.info.board();
      const n = Math.max(p, board.length + (board.some((e) => e.name === this.name()) ? 0 : 1));
      drawText(ctx, p <= 50 ? `#${p} OF ${n} TODAY` : 'OUTSIDE THE TOP 50', x, y, { scale: 2, color: p === 1 ? '#5aff6a' : '#ffd84a' });
      y += 17;
    } else {
      drawText(ctx, 'BOARD OFFLINE', x, y, { color: '#8090a8' });
      y += 11;
    }
    drawText(ctx, `TODAY'S BEST ${formatTime(this.best * DT)}`, x, y, { color: '#9cff9c' });
  }
}
