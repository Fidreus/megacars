// Client-side prediction. The client runs the world a few ticks ahead of the
// server with its own inputs applied immediately. Each server snapshot is the
// truth for an earlier tick: the client restores it and re-simulates its own
// remembered inputs up to where it was, so its car responds without delay and
// still ends up exactly where the server puts it. Cars driven by other people
// are predicted with their latest known input; computer cars are
// deterministic and predicted exactly.

import type { CarTuning } from '../config/tuning.ts';
import { copyInput, neutralInput, type CarInput } from '../sim/input.ts';
import { stepWorld } from '../sim/step.ts';
import type { Track } from '../track/types.ts';
import type { World } from '../sim/world.ts';
import { applySnapshot, peekSnapshot } from './snapshot.ts';

const HISTORY = 256;
/** Don't re-simulate more than this many ticks for one snapshot. */
const MAX_RESIM = 240;
/** How far ahead of need (ticks) inputs aim to reach the server: at least, and at most. */
const MIN_TARGET = 2;
const MAX_TARGET = 10;

export interface Correction {
  dx: number;
  dz: number;
  dh: number;
}

export class Predictor {
  readonly world: World;
  readonly track: Track;
  readonly tunings: CarTuning[];
  /** Input used for each car on the next step. */
  readonly inputs: CarInput[];
  /** Latest input the server reported for each car. */
  readonly remote: CarInput[];
  /** Cars driven by this client. */
  readonly localCars: number[];
  /** Per-car visual jump caused by the last reconcile (old minus new pose). */
  readonly corrections: Correction[];
  /** Tick of the newest snapshot applied (-1 = none yet). */
  serverTick = -1;
  /** Input lead the server reported (ticks; see SnapshotMeta). */
  lead = 0;
  /** Number of re-simulated ticks in the last reconcile. */
  lastResim = 0;
  private readonly history: CarInput[][] = [];
  private readonly historyTick = new Int32Array(HISTORY).fill(-1);
  private readonly before: Float64Array;

  constructor(world: World, track: Track, tunings: CarTuning[], localCars: number[]) {
    this.world = world;
    this.track = track;
    this.tunings = tunings;
    this.localCars = localCars;
    this.inputs = world.cars.map(() => neutralInput());
    this.remote = world.cars.map(() => neutralInput());
    this.corrections = world.cars.map(() => ({ dx: 0, dz: 0, dh: 0 }));
    this.before = new Float64Array(world.cars.length * 3);
    for (let k = 0; k < HISTORY; k++) this.history.push(localCars.map(() => neutralInput()));
  }

  get synced(): boolean {
    return this.serverTick >= 0;
  }

  /** Simulate the next tick with the local players' inputs (index = local player). */
  step(local: readonly CarInput[]): void {
    const t = this.world.tick;
    const slot = t % HISTORY;
    this.historyTick[slot] = t;
    const h = this.history[slot];
    for (let p = 0; p < this.localCars.length; p++) copyInput(h[p], local[p] ?? neutralInput());
    this.simulate();
  }

  /** The local input recorded for tick `t`, if still remembered. */
  inputAt(t: number, p: number): CarInput | null {
    const slot = t % HISTORY;
    return this.historyTick[slot] === t ? this.history[slot][p] : null;
  }

  private simulate(): void {
    const t = this.world.tick;
    for (let i = 0; i < this.inputs.length; i++) copyInput(this.inputs[i], this.remote[i]);
    for (let p = 0; p < this.localCars.length; p++) {
      const inp = this.inputAt(t, p);
      if (inp) copyInput(this.inputs[this.localCars[p]], inp);
    }
    stepWorld(this.world, this.track, this.inputs, this.tunings);
  }

  /**
   * Apply an authoritative snapshot and re-simulate up to the current
   * predicted tick (or to `frontier` if given and later). Returns false if
   * the snapshot was stale or malformed.
   */
  reconcile(data: Uint8Array, frontier = this.world.tick): boolean {
    const head = peekSnapshot(data);
    if (!head || head.tick <= this.serverTick || head.carCount !== this.world.cars.length) return false;
    const cars = this.world.cars;
    const target = Math.max(frontier, this.world.tick);
    const hadState = this.synced;
    for (let i = 0; i < cars.length; i++) {
      this.before[i * 3] = cars[i].x;
      this.before[i * 3 + 1] = cars[i].z;
      this.before[i * 3 + 2] = cars[i].heading;
    }
    applySnapshot(data, this.world, this.remote);
    this.serverTick = head.tick;
    this.lead = head.meta.lead;
    let n = 0;
    const end = Math.min(target, head.tick + MAX_RESIM);
    while (this.world.tick < end) {
      this.simulate();
      n++;
    }
    this.lastResim = n;
    for (let i = 0; i < cars.length; i++) {
      const c = this.corrections[i];
      if (!hadState) {
        c.dx = c.dz = c.dh = 0;
        continue;
      }
      c.dx = this.before[i * 3] - cars[i].x;
      c.dz = this.before[i * 3 + 1] - cars[i].z;
      let dh = this.before[i * 3 + 2] - cars[i].heading;
      dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
      c.dh = dh;
    }
    return true;
  }
}

/**
 * Decides how fast the client's predicted clock runs so its inputs reach the
 * server a little before they are needed: slightly faster when they arrive
 * late, slightly slower when they arrive too early, and a jump when far off.
 */
export class LeadControl {
  /** Desired minimum lead (ticks) of inputs arriving at the server. */
  target = MIN_TARGET;
  /** Ticks to add right now (positive: run ahead; negative: hold back). */
  jump = 0;
  private cooldown = 0;
  /** Snapshots until the target may rise again, and since inputs were last late. */
  private raiseCool = 0;
  private calm = 0;

  /**
   * Called once per received snapshot with the lead the server measured.
   * `rttTicks` is the round trip; jumps wait for one round trip to show up.
   */
  update(lead: number, rttTicks: number): number {
    // -999: the server has no input from us yet.
    if (lead <= -999) return 1;
    this.adapt(lead);
    if (this.cooldown > 0) {
      this.cooldown--;
      return 1;
    }
    const err = this.target - lead;
    if (err > 8 || err < -20) {
      this.jump = err;
      // Snapshots arrive every 3 ticks; skip feedback that predates the jump.
      this.cooldown = Math.ceil((rttTicks + 6) / 3);
      return 1;
    }
    return 1 + Math.max(-0.05, Math.min(0.05, err * 0.012));
  }

  /**
   * A shaky connection delivers some inputs late, and the server then has to
   * guess them: the car jumps when the truth comes back. So when inputs are
   * late, aim to send them further ahead; when they have been on time for a
   * while, creep back (a smaller lead keeps other cars closer to the truth).
   */
  private adapt(lead: number): void {
    if (this.raiseCool > 0) this.raiseCool--;
    if (lead < 1) {
      this.calm = 0;
      if (this.raiseCool === 0 && this.target < MAX_TARGET) {
        this.target = Math.min(MAX_TARGET, this.target + 2);
        this.raiseCool = 40;
      }
    } else if (++this.calm > 300 && this.target > MIN_TARGET) {
      this.target--;
      this.calm = 0;
    }
  }

  /** Ignore feedback for about one round trip (after (re)starting the clock). */
  hold(rttTicks: number): void {
    this.cooldown = Math.ceil((rttTicks + 6) / 3);
  }
}
