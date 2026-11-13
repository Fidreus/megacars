// Lap record boards: verified best laps per track, kept per simulation
// version in DATA_DIR/records/v<SIM_VERSION>/records.json (point DATA_DIR at a
// persistent volume in production). A new version starts empty boards in a
// new folder; older folders and the pre-versioning DATA_DIR/records.json are
// never read, written or deleted. Submissions are replayed in a worker
// thread, one at a time, and the server's own lap times go on the board. The
// race of every entry is kept beside the board (replays/<id>.json) so others
// can race its ghost.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { SIM_VERSION } from '../shared/config/constants.ts';
import { cleanName, PROTOCOL_VERSION } from '../shared/net/protocol.ts';
import { boardKey } from '../shared/game/leagues.ts';
import { insertRecord, REPLAY_ID, specProblem, type Boards, type RecordEntry, type RecordSubmission, type StoredReplay } from '../shared/game/records.ts';
import { TRACKS } from '../shared/track/defs/index.ts';

const JOB_TIMEOUT_MS = 15_000;
const MAX_QUEUE = 8;
/** Largest replay file served (a submission is at most 400 kB). */
export const MAX_REPLAY_FILE = 1_000_000;

export interface SubmitResult {
  ok: boolean;
  error?: string;
  /** Best verified lap of the race (ticks). */
  best?: number;
  /** Place on the track's board (0 = not on it). */
  rank?: number;
}

interface Job {
  id: number;
  sub: RecordSubmission;
  done: (r: SubmitResult) => void;
}

export class RecordStore {
  boards: Boards = {};
  /** This version's folder. */
  readonly dir: string;
  private readonly file: string;
  /** The board file could not be read or moved aside: don't save over it. */
  private readOnly = false;
  private readonly replayDir: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** Replays of entries that left a board: deleted once the board is saved. */
  private dropped: string[] = [];
  private worker: Worker | null = null;
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private jobTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  constructor(dataDir: string, version = SIM_VERSION) {
    this.dir = join(dataDir, 'records', `v${version}`);
    this.file = join(this.dir, 'records.json');
    this.replayDir = join(this.dir, 'replays');
    mkdirSync(this.replayDir, { recursive: true });
    let readable = true;
    if (existsSync(this.file)) {
      try {
        this.boards = parseBoards(readFileSync(this.file, 'utf8'));
      } catch (e) {
        // Never overwrite a board we could not read: move it aside first.
        readable = false;
        const aside = `${this.file}.bad-${Date.now()}`;
        console.warn('records: could not read', this.file, e, '- kept as', aside);
        try {
          renameSync(this.file, aside);
        } catch {
          // Can't move it: then never write over it.
          this.readOnly = true;
        }
      }
    }
    if (readable) this.removeOrphans();
    const n = Object.values(this.boards).reduce((k, b) => k + b.length, 0);
    console.log(`records: ${n} entries in ${this.file}`);
  }

  /** The boards to show: tracks this server knows (others stay on disk). */
  served(): Boards {
    const out: Boards = {};
    for (const [key, board] of Object.entries(this.boards)) if (TRACKS[key.split('@')[0]]) out[key] = board;
    return out;
  }

  /** The stored race of a board entry, as JSON text, or null. */
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

  /** Queue a submission for checking; resolves when it is done. */
  submit(sub: RecordSubmission): Promise<SubmitResult> {
    if (!sub || sub.v !== PROTOCOL_VERSION) return Promise.resolve({ ok: false, error: 'version' });
    const problem = specProblem(sub.spec);
    if (problem) return Promise.resolve({ ok: false, error: problem });
    if (typeof sub.replay !== 'string') return Promise.resolve({ ok: false, error: 'bad replay' });
    if (this.queue.length >= MAX_QUEUE) return Promise.resolve({ ok: false, error: 'busy' });
    return new Promise((done) => {
      this.queue.push({ id: this.nextId++, sub, done });
      this.pump();
    });
  }

  /** Write the boards now (shutdown). */
  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.save();
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./recordWorker.ts', import.meta.url));
    w.on('message', (m: { id: number; result: { laps: number[] } | { error: string } }) => this.finish(m.id, m.result));
    w.on('error', (e) => {
      console.warn('records: worker error', e);
      this.restart({ error: 'server error' });
    });
    w.unref();
    this.worker = w;
    return w;
  }

  private restart(result: { error: string }): void {
    void this.worker?.terminate();
    this.worker = null;
    if (this.running) this.finish(this.running.id, result);
  }

  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    const job = this.queue.shift()!;
    this.running = job;
    this.ensureWorker().postMessage({ id: job.id, spec: job.sub.spec, replay: job.sub.replay });
    this.jobTimer = setTimeout(() => this.restart({ error: 'too slow' }), JOB_TIMEOUT_MS);
  }

  private finish(id: number, result: { laps: number[] } | { error: string }): void {
    const job = this.running;
    if (!job || job.id !== id) return;
    this.running = null;
    if (this.jobTimer) clearTimeout(this.jobTimer);
    if ('error' in result) {
      job.done({ ok: false, error: result.error });
    } else if (result.laps.length === 0) {
      job.done({ ok: false, error: 'no complete lap' });
    } else {
      const best = Math.min(...result.laps);
      job.done(this.place(job.sub, best));
    }
    this.pump();
  }

  /** Put a checked lap on its board, with its race kept beside it. */
  private place(sub: RecordSubmission, best: number): SubmitResult {
    const key = boardKey(sub.spec.track, sub.spec.league);
    const board = (this.boards[key] ??= []);
    const entry: RecordEntry = { name: cleanName(sub.name) || 'DRIVER', ticks: best, at: Date.now(), id: randomBytes(8).toString('hex') };
    const next = board.slice();
    const rank = insertRecord(next, entry);
    if (rank === 0) return { ok: true, best, rank };
    const stored: StoredReplay = { v: SIM_VERSION, key, name: entry.name, ticks: best, at: entry.at, spec: sub.spec, replay: sub.replay };
    try {
      writeAtomic(join(this.replayDir, `${entry.id}.json`), JSON.stringify(stored));
    } catch (e) {
      console.warn('records: could not keep the replay', e);
      return { ok: false, error: 'server error' };
    }
    const kept = new Set(next.map((e) => e.id));
    for (const e of board) if (e.id && !kept.has(e.id)) this.dropped.push(e.id);
    board.splice(0, board.length, ...next);
    this.scheduleSave();
    return { ok: true, best, rank };
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 2000);
  }

  private save(): void {
    if (this.readOnly) return;
    try {
      writeAtomic(this.file, JSON.stringify(this.boards));
    } catch (e) {
      console.warn('records: could not save', e);
      return;
    }
    // Only now that no saved entry points at them.
    for (const id of this.dropped.splice(0)) removeQuietly(join(this.replayDir, `${id}.json`));
  }

  /** Replays no entry points at (left by a crash between the two writes). */
  private removeOrphans(): void {
    const used = new Set<string>();
    for (const board of Object.values(this.boards)) for (const e of board) if (e.id) used.add(e.id);
    let files: string[] = [];
    try {
      files = readdirSync(this.replayDir);
    } catch {
      return;
    }
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      if (f.endsWith('.json') && REPLAY_ID.test(id) && !used.has(id)) removeQuietly(join(this.replayDir, f));
    }
  }
}

/** Boards from JSON; throws if it is not boards at all. */
function parseBoards(text: string): Boards {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not boards');
  const out: Boards = {};
  for (const [key, board] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(board)) throw new Error('not boards');
    out[key] = board as RecordEntry[];
  }
  return out;
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
