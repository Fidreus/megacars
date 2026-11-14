// Daily challenge boards: the day's fastest verified laps, one file per day
// in DATA_DIR/daily/v<SIM_VERSION>/<day>.json beside the record boards (a new
// simulation version starts afresh in a new folder, like the records). A
// lap is checked by replaying its race exactly as for the world boards (the
// same check also puts it on the world board when it is good enough). The
// race of the top ten of the day is kept for their ghosts; once the day is
// over only the winner's stays. Boards older than 30 days are deleted.
// Which day it is comes from the server's clock (injected in tests).

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SIM_VERSION } from '../shared/config/constants.ts';
import { cleanName, PROTOCOL_VERSION } from '../shared/net/protocol.ts';
import { boardKey, leagueOf } from '../shared/game/leagues.ts';
import {
  addDays, DAILY_DAYS_KEPT, DAILY_MOODS, DAILY_REPLAYS, dailyChallenge, dailySpecProblem, DAY_RE, dayNumber, dayOf, dayOpen, insertDaily, nextDayStart,
  type DailyChallenge, type DailyEntry, type DailyResult, type DailySubmission, type DailyView,
} from '../shared/game/daily.ts';
import { REPLAY_ID, type StoredReplay } from '../shared/game/records.ts';
import { MAX_REPLAY_FILE, type SubmitResult } from './records.ts';

/** Checks a race and returns its best lap: RecordStore.submit (which also fills the world board). */
export type Verify = (sub: DailySubmission) => Promise<SubmitResult>;

interface DayBoard {
  day: string;
  /** Fixed when the board is made, so a changed track list can't move a running day. */
  challenge: DailyChallenge;
  entries: DailyEntry[];
  /** The day is over and only the winner's race is kept. */
  closed?: boolean;
}

export interface DailyOptions {
  /** The clock (ms); tests move it. */
  now?: () => number;
  version?: number;
}

export class DailyStore {
  readonly dir: string;
  private readonly replayDir: string;
  private readonly now: () => number;
  private readonly verify: Verify;
  private readonly boards = new Map<string, DayBoard>();
  /** Days whose file could not be read or moved aside: never written. */
  private readonly readOnly = new Set<string>();
  /** A board could not be read: which races are unused is unknown, so none are swept. */
  private unsure = false;
  private readonly dirty = new Set<string>();
  /** Races of entries that lost them: deleted once the boards are saved. */
  private dropped: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string, verify: Verify, opts: DailyOptions = {}) {
    this.dir = join(dataDir, 'daily', `v${opts.version ?? SIM_VERSION}`);
    this.replayDir = join(this.dir, 'replays');
    this.now = opts.now ?? Date.now;
    this.verify = verify;
    mkdirSync(this.replayDir, { recursive: true });
    for (const f of readdirSync(this.dir)) {
      const day = f.replace(/\.json$/, '');
      if (!f.endsWith('.json') || !DAY_RE.test(day)) continue;
      const file = join(this.dir, f);
      try {
        this.boards.set(day, parseDay(readFileSync(file, 'utf8'), day));
      } catch (e) {
        // Never overwrite a board we could not read: move it aside first.
        this.unsure = true;
        const aside = `${file}.bad-${Date.now()}`;
        console.warn('daily: could not read', file, e, '- kept as', aside);
        try {
          renameSync(file, aside);
        } catch {
          this.readOnly.add(day);
        }
      }
    }
    this.sweep();
    if (!this.unsure) this.removeOrphans();
    console.log(`daily: ${this.boards.size} days in ${this.dir}`);
  }

  /** The server's day now. */
  today(): string {
    return dayOf(this.now());
  }

  /** A day's challenge: as its board has it, or worked out from the date. */
  challenge(day: string): DailyChallenge {
    return this.boards.get(day)?.challenge ?? dailyChallenge(day);
  }

  /** GET /api/daily: today's challenge and board, and yesterday's top three. */
  view(): DailyView {
    this.sweep();
    const now = this.now();
    const day = dayOf(now);
    const y = this.boards.get(addDays(day, -1));
    return {
      ok: true,
      now,
      endsAt: nextDayStart(now),
      challenge: this.challenge(day),
      board: this.boards.get(day)?.entries ?? [],
      yesterday: y && y.entries.length ? { challenge: y.challenge, top: y.entries.slice(0, 3) } : null,
    };
  }

  /** A kept day's board (null if none); past days don't change any more. */
  pastDay(day: string): { ok: true; challenge: DailyChallenge; board: DailyEntry[]; over: boolean } | null {
    const b = this.boards.get(day);
    if (!b) return null;
    return { ok: true, challenge: b.challenge, board: b.entries, over: !dayOpen(day, this.now()) };
  }

  /** The kept race of a day's entry, as JSON text, or null. */
  replayText(id: string): string | null {
    if (!REPLAY_ID.test(id)) return null;
    const file = join(this.replayDir, `${id}.json`);
    try {
      if (statSync(file).size > MAX_REPLAY_FILE) return null;
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  /** Why a submission can't be for its day, or null (checked before the replay). */
  problem(sub: DailySubmission): string | null {
    if (!sub || typeof sub !== 'object' || sub.v !== PROTOCOL_VERSION) return 'version';
    if (typeof sub.day !== 'string' || !Number.isFinite(dayNumber(sub.day))) return 'bad day';
    if (!dayOpen(sub.day, this.now())) return 'not today';
    if (this.readOnly.has(sub.day)) return 'server error';
    return dailySpecProblem(sub.spec, this.challenge(sub.day));
  }

  /** Check a lap for its day's board: replayed, then placed. */
  async submit(sub: DailySubmission): Promise<DailyResult> {
    const problem = this.problem(sub);
    if (problem) return { ok: false, error: problem };
    const r = await this.verify(sub);
    if (!r.ok || !r.best) return { ok: false, error: r.error ?? 'no complete lap' };
    return { ...this.place(sub, r.best), worldRank: r.rank ?? 0 };
  }

  /** Put a checked lap on its day's board, keeping its race while it is in the top ten. */
  place(sub: DailySubmission, best: number): DailyResult {
    const day = sub.day;
    let b = this.boards.get(day);
    if (!b) {
      b = { day, challenge: this.challenge(day), entries: [] };
      this.boards.set(day, b);
    }
    const name = cleanName(sub.name) || 'DRIVER';
    const entry: DailyEntry = { name, ticks: best, at: this.now(), id: randomBytes(8).toString('hex') };
    const next = b.entries.slice();
    const rank = insertDaily(next, entry);
    const placeOf = (list: DailyEntry[]) => list.findIndex((e) => e.name === name) + 1;
    if (rank === 0) return { ok: true, best, rank: 0, place: placeOf(b.entries) };
    const keep = rank <= (b.closed ? 1 : DAILY_REPLAYS);
    if (keep) {
      const stored: StoredReplay & { day: string } = {
        v: SIM_VERSION, day, key: boardKey(b.challenge.track, b.challenge.league), name, ticks: best, at: entry.at, spec: sub.spec, replay: sub.replay,
      };
      try {
        writeAtomic(join(this.replayDir, `${entry.id}.json`), JSON.stringify(stored));
      } catch (e) {
        console.warn('daily: could not keep the race', e);
        return { ok: false, error: 'server error' };
      }
    } else delete entry.id;
    // Entries that left the board, or the top ten, lose their race.
    const limit = b.closed ? 1 : DAILY_REPLAYS;
    const out = new Set(next);
    for (const e of b.entries) if (e.id && !out.has(e)) this.dropped.push(e.id);
    b.entries = next.map((e, i) => {
      if (i < limit || !e.id) return e;
      this.dropped.push(e.id);
      const { id: _, ...rest } = e;
      return rest;
    });
    this.dirty.add(day);
    this.scheduleSave();
    return { ok: true, best, rank, place: rank };
  }

  /**
   * Day housekeeping: a day that is over keeps only its winner's race, and
   * boards older than 30 days go. Runs on every request and every hour.
   */
  sweep(): void {
    const now = this.now();
    const today = dayNumber(dayOf(now));
    for (const [day, b] of this.boards) {
      if (this.readOnly.has(day)) continue;
      if (dayNumber(day) <= today - DAILY_DAYS_KEPT) {
        // Keep the file until it is certainly gone from the boards.
        this.boards.delete(day);
        for (const e of b.entries) if (e.id) this.dropped.push(e.id);
        this.dirty.add(day);
        continue;
      }
      if (!b.closed && !dayOpen(day, now) && dayNumber(day) < today) {
        b.entries = b.entries.map((e, i) => {
          if (i === 0 || !e.id) return e;
          this.dropped.push(e.id);
          const { id: _, ...rest } = e;
          return rest;
        });
        b.closed = true;
        this.dirty.add(day);
      }
    }
    if (this.dirty.size) this.scheduleSave();
  }

  /** Write everything now (shutdown, tests). */
  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 2000);
    this.saveTimer.unref?.();
  }

  private save(): void {
    let failed = false;
    for (const day of [...this.dirty]) {
      if (this.readOnly.has(day)) {
        this.dirty.delete(day);
        continue;
      }
      const file = join(this.dir, `${day}.json`);
      const b = this.boards.get(day);
      try {
        if (b) writeAtomic(file, JSON.stringify(b));
        else if (existsSync(file)) unlinkSync(file);
        this.dirty.delete(day);
      } catch (e) {
        console.warn('daily: could not save', day, e);
        failed = true;
      }
    }
    if (failed) {
      // Try again later; until then the races stay.
      this.scheduleSave();
      return;
    }
    // Only now that no saved entry points at them.
    for (const id of this.dropped.splice(0)) removeQuietly(join(this.replayDir, `${id}.json`));
  }

  /** Races no entry points at (left by a crash between the two writes). */
  private removeOrphans(): void {
    const used = new Set<string>();
    for (const b of this.boards.values()) for (const e of b.entries) if (e.id) used.add(e.id);
    let files: string[] = [];
    try {
      files = readdirSync(this.replayDir);
    } catch {
      return;
    }
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (f.endsWith('.json') && REPLAY_ID.test(id) && !used.has(id) && !this.dropped.includes(id)) removeQuietly(join(this.replayDir, f));
    }
  }
}

/** A day's board from JSON; throws if it is not one. */
function parseDay(text: string, day: string): DayBoard {
  const raw = JSON.parse(text) as Partial<DayBoard> | null;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries) || raw.day !== day) throw new Error('not a day board');
  const c = raw.challenge;
  if (!c || typeof c.track !== 'string' || !(DAILY_MOODS as readonly string[]).includes(c.mood)) throw new Error('not a day board');
  return { day, challenge: { day, track: c.track, league: leagueOf(c.league), mood: c.mood }, entries: raw.entries as DailyEntry[], closed: !!raw.closed };
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function removeQuietly(file: string): void {
  try {
    unlinkSync(file);
  } catch {
    // Already gone.
  }
}
