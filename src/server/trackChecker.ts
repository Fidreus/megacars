// Checks player tracks in a worker thread, one at a time: for rooms (the
// host's tournament tracks, built there and cached here) and for publishing
// (with an AI test). Answers are remembered by track id.

import { Worker } from 'node:worker_threads';
import { adoptTrack, isTrackBuilt, setCustomTrackCache } from '../shared/track/builder.ts';
import { decodeTrack } from '../shared/track/custom.ts';
import { registerTrack, trackDef } from '../shared/track/defs/index.ts';
import type { TrackDef } from '../shared/track/types.ts';
import type { TrackJob, TrackJobResult } from './trackWorker.ts';

const JOB_TIMEOUT_MS = 20_000;
const MAX_QUEUE = 24;

export type CheckResult = { ok: true; def: TrackDef; length: number; bestLap?: number } | { ok: false; error: string };

interface Job {
  job: TrackJob;
  done: (r: CheckResult) => void;
}

export class TrackChecker {
  private worker: Worker | null = null;
  private readonly queue: Job[] = [];
  private running: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  /** Earlier answers (id -> problem, or '' for fine), most recent last. */
  private readonly known = new Map<string, string>();

  constructor() {
    // Rooms race several player tracks at once.
    setCustomTrackCache(24);
  }

  /**
   * Check a track for a room and build it (the build is cached for the race).
   * Resolves with the registered definition or the problem.
   */
  forRoom(code: string): Promise<CheckResult> {
    const def = decodeTrack(code);
    if (!def) return Promise.resolve({ ok: false, error: 'not a track' });
    const seen = this.known.get(def.id);
    if (seen) return Promise.resolve({ ok: false, error: seen });
    if (seen === '' && isTrackBuilt(def.id) && trackDef(def.id)) return Promise.resolve({ ok: true, def: trackDef(def.id)!, length: 0 });
    return this.run({ id: 0, code, build: true });
  }

  /** Build a track that was checked before but has dropped out of the cache. */
  build(def: TrackDef, code: string): Promise<CheckResult> {
    if (isTrackBuilt(def.id)) return Promise.resolve({ ok: true, def, length: 0 });
    return this.run({ id: 0, code, build: true });
  }

  /** The full check for publishing: builds, has a pit, and the AI gets round. */
  forPublishing(code: string): Promise<CheckResult> {
    return this.run({ id: 0, code, ai: true });
  }

  get busy(): boolean {
    return this.queue.length >= MAX_QUEUE;
  }

  stop(): void {
    void this.worker?.terminate();
    this.worker = null;
  }

  private run(job: TrackJob): Promise<CheckResult> {
    if (this.busy) return Promise.resolve({ ok: false, error: 'the server is busy, try again' });
    return new Promise((done) => {
      this.queue.push({ job: { ...job, id: this.nextId++ }, done });
      this.pump();
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./trackWorker.ts', import.meta.url));
    w.on('message', (m: TrackJobResult) => this.finish(m));
    w.on('error', (e) => {
      console.warn('tracks: worker error', e);
      this.restart('server error');
    });
    w.unref();
    this.worker = w;
    return w;
  }

  private restart(error: string): void {
    this.stop();
    if (this.running) this.finish({ id: this.running.job.id, error });
  }

  private pump(): void {
    if (this.running || !this.queue.length) return;
    const job = this.queue.shift()!;
    this.running = job;
    this.ensureWorker().postMessage(job.job);
    this.timer = setTimeout(() => this.restart('the track takes too long to check'), JOB_TIMEOUT_MS);
  }

  private finish(m: TrackJobResult): void {
    const job = this.running;
    if (!job || job.job.id !== m.id) return;
    this.running = null;
    if (this.timer) clearTimeout(this.timer);
    if ('error' in m) {
      // Server trouble isn't the track's fault: don't remember it.
      if (!/server|busy|long/.test(m.error)) this.remember(decodeTrack(job.job.code)?.id, m.error);
      job.done({ ok: false, error: m.error });
    } else {
      registerTrack(m.def);
      const def = trackDef(m.def.id)!;
      if (m.track) adoptTrack(def, m.track);
      this.remember(def.id, '');
      job.done({ ok: true, def, length: m.length, bestLap: m.bestLap });
    }
    this.pump();
  }

  private remember(id: string | undefined, problem: string): void {
    if (!id) return;
    this.known.delete(id);
    this.known.set(id, problem);
    if (this.known.size > 500) this.known.delete(this.known.keys().next().value!);
  }
}
