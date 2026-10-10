// Lap record boards: verified best laps per track, kept in DATA_DIR/records.json
// (point DATA_DIR at a persistent volume in production). Submissions are
// replayed in a worker thread, one at a time, and the server's own lap
// times go on the board.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { cleanName, PROTOCOL_VERSION } from '../shared/net/protocol.ts';
import { insertRecord, specProblem, type Boards, type RecordSubmission } from '../shared/game/records.ts';
import { TRACKS } from '../shared/track/defs/index.ts';

const JOB_TIMEOUT_MS = 15_000;
const MAX_QUEUE = 8;

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
  private readonly file: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private worker: Worker | null = null;
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private jobTimer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'records.json');
    try {
      if (existsSync(this.file)) this.boards = JSON.parse(readFileSync(this.file, 'utf8')) as Boards;
    } catch (e) {
      console.warn('records: could not read', this.file, e);
    }
    for (const id of Object.keys(this.boards)) if (!TRACKS[id]) delete this.boards[id];
    const n = Object.values(this.boards).reduce((k, b) => k + b.length, 0);
    console.log(`records: ${n} entries in ${this.file}`);
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
      const track = job.sub.spec.track;
      const board = (this.boards[track] ??= []);
      const name = cleanName(job.sub.name) || 'DRIVER';
      const rank = insertRecord(board, { name, ticks: best, at: Date.now() });
      if (rank > 0) this.scheduleSave();
      job.done({ ok: true, best, rank });
    }
    this.pump();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const tmp = `${this.file}.tmp`;
        writeFileSync(tmp, JSON.stringify(this.boards));
        renameSync(tmp, this.file);
      } catch (e) {
        console.warn('records: could not save', e);
      }
    }, 2000);
  }
}
