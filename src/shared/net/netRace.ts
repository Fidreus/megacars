// The client's side of an online race, without any browser APIs: builds the
// world from the race spec, runs the predicted clock, sends inputs and folds
// in server snapshots. The browser session and the tests both drive this.

import { DT } from '../config/constants.ts';
import type { CarTuning } from '../config/tuning.ts';
import { createRaceWorld } from '../game/raceSetup.ts';
import { neutralInput, quantizeInput, type CarInput } from '../sim/input.ts';
import type { World } from '../sim/world.ts';
import type { Track } from '../track/types.ts';
import { Predictor, LeadControl } from './predictor.ts';
import { encodeInput, INPUT_SIZE, type RaceSpec } from './protocol.ts';

export interface StepHooks {
  /** Fill the input of local player p for the coming tick. */
  sample(p: number, out: CarInput): CarInput | void;
  before?(): void;
  after?(): void;
  /** A snapshot moved cars; `drift` holds the jumps (old minus new pose). */
  corrected?(drift: NetRace['drift']): void;
}

/**
 * At most this many predicted ticks per update. Online the clock must not
 * lose time on slow frames (the server keeps going), so this is generous.
 */
const MAX_STEPS = 40;

export class NetRace {
  readonly spec: RaceSpec;
  readonly track: Track;
  readonly world: World;
  /** Each car's handling (league and upgrades applied). */
  readonly tunings: CarTuning[];
  readonly predictor: Predictor;
  readonly localCars: number[];
  readonly names: string[];
  readonly colors: string[];
  readonly lead = new LeadControl();
  /** Round-trip time to the server in ms (kept up to date by the caller). */
  rttMs = 100;
  /** Current clock rate (1 = real time). */
  rate = 1;
  /** Corrections accumulated since the view last took them (per car). */
  readonly drift: { dx: number; dz: number; dh: number }[];
  /**
   * Connection health for the on-screen diagnostics (key 2): clock jumps,
   * frames over 0.1 s, and how far your own car was corrected (metres in
   * the last second, and the largest single correction then).
   */
  readonly stats = {
    jumps: 0, slowFrames: 0, corrPerSec: 0, corrMax: 0,
    /** Totals over the race: server corrections of your own car (count, metres, how many over 0.3 m, the largest). */
    fixes: 0, fixMetres: 0, bigFixes: 0, worstFix: 0,
  };
  private corrAcc = 0;
  private corrMaxAcc = 0;
  private corrTime = 0;
  /** Ticks still to shed by running slow (instead of freezing the clock). */
  private shed = 0;
  private readonly pose: Float64Array;
  private pending: Uint8Array | null = null;
  private acc = 0;
  private readonly local: CarInput[];
  private readonly packet = new Uint8Array(INPUT_SIZE);
  private readonly send: (data: Uint8Array) => void;

  constructor(spec: RaceSpec, playerId: number, send: (data: Uint8Array) => void) {
    this.spec = spec;
    this.send = send;
    const { track, world, tunings } = createRaceWorld(spec);
    this.track = track;
    this.world = world;
    this.localCars = [];
    spec.entrants.forEach((e, i) => {
      if (e.playerId === playerId) this.localCars.push(i);
    });
    this.names = spec.entrants.map((e) => e.name);
    this.colors = spec.entrants.map((e) => e.color);
    this.tunings = tunings;
    this.predictor = new Predictor(world, track, tunings, this.localCars);
    this.local = this.localCars.map(() => neutralInput());
    this.drift = world.cars.map(() => ({ dx: 0, dz: 0, dh: 0 }));
    this.pose = new Float64Array(world.cars.length * 3);
  }

  get spectating(): boolean {
    return this.localCars.length === 0;
  }

  get synced(): boolean {
    return this.predictor.synced;
  }

  /** The latest input this client used for local player p. */
  input(p: number): CarInput {
    return this.local[p];
  }

  /** A snapshot arrived; it is applied at the next update. Only the newest matters. */
  snapshot(data: Uint8Array): void {
    this.pending = data;
  }

  private get rttTicks(): number {
    return this.rttMs / 1000 / DT;
  }

  /** Advance by `dt` seconds of real time. Returns the number of new ticks simulated. */
  update(dt: number, hooks: StepHooks): number {
    if (dt > 0.1) this.stats.slowFrames++;
    this.corrTime += dt;
    if (this.corrTime >= 1) {
      this.stats.corrPerSec = this.corrAcc / this.corrTime;
      this.stats.corrMax = this.corrMaxAcc;
      this.corrAcc = this.corrMaxAcc = this.corrTime = 0;
    }
    if (this.pending) {
      this.applyPending();
      if (hooks.corrected) {
        hooks.corrected(this.drift);
        for (const d of this.drift) d.dx = d.dz = d.dh = 0;
      }
    }
    if (!this.synced) return 0;
    let extra = 0;
    if (this.lead.jump !== 0) this.stats.jumps++;
    if (this.lead.jump > 0) extra = Math.min(this.lead.jump, 120);
    // Too far ahead: run slow until it's shed (freezing the clock froze the car).
    else if (this.lead.jump < 0) this.shed = -this.lead.jump;
    this.lead.jump = 0;
    let rate = this.rate;
    if (this.shed > 0) {
      rate = Math.min(rate, 0.75);
      this.shed = Math.max(0, this.shed - dt * (1 - rate) / DT);
    }
    this.acc += dt * rate;
    let steps = 0;
    if (extra > 0) {
      // Catching up in one go: let the cars glide forward rather than leap.
      const cars = this.world.cars;
      for (let i = 0; i < cars.length; i++) {
        this.pose[i * 3] = cars[i].x;
        this.pose[i * 3 + 1] = cars[i].z;
        this.pose[i * 3 + 2] = cars[i].heading;
      }
      while (extra > 0) {
        this.stepOnce(hooks);
        extra--;
        steps++;
      }
      for (let i = 0; i < cars.length; i++) {
        const d = this.drift[i];
        d.dx += this.pose[i * 3] - cars[i].x;
        d.dz += this.pose[i * 3 + 1] - cars[i].z;
        let dh = this.pose[i * 3 + 2] - cars[i].heading;
        dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2;
        d.dh += dh;
      }
      if (hooks.corrected) {
        hooks.corrected(this.drift);
        for (const d of this.drift) d.dx = d.dz = d.dh = 0;
      }
    }
    while (this.acc >= DT && steps < MAX_STEPS) {
      this.stepOnce(hooks);
      this.acc -= DT;
      steps++;
    }
    if (this.acc > DT * MAX_STEPS) this.acc = DT * MAX_STEPS;
    return steps;
  }

  /** Fraction of a tick elapsed since the last step (for interpolation). */
  get alpha(): number {
    return Math.max(0, Math.min(1, this.acc / DT));
  }

  private stepOnce(hooks: StepHooks): void {
    const t = this.world.tick;
    for (let p = 0; p < this.local.length; p++) {
      quantizeInput(hooks.sample(p, this.local[p]) ?? this.local[p]);
      this.send(encodeInput(t, this.local[p], this.packet));
    }
    hooks.before?.();
    this.predictor.step(this.local);
    hooks.after?.();
  }

  private applyPending(): void {
    const data = this.pending!;
    this.pending = null;
    const p = this.predictor;
    const first = !p.synced;
    const ahead = Math.ceil(this.rttTicks / 2) + this.lead.target + 1;
    const ok = first ? p.reconcile(data, this.serverTickOf(data) + (this.spectating ? 0 : ahead)) : p.reconcile(data);
    if (!ok) return;
    if (first) this.lead.hold(this.rttTicks);
    for (let i = 0; i < this.drift.length; i++) {
      const c = p.corrections[i];
      const d = this.drift[i];
      d.dx += c.dx;
      d.dz += c.dz;
      d.dh += c.dh;
    }
    for (const i of this.localCars) {
      const m = Math.hypot(p.corrections[i].dx, p.corrections[i].dz);
      this.corrAcc += m;
      this.corrMaxAcc = Math.max(this.corrMaxAcc, m);
      if (this.world.tick > this.world.race.startTick + 120) {
        this.stats.fixes++;
        this.stats.fixMetres += m;
        if (m > 0.3) this.stats.bigFixes++;
        this.stats.worstFix = Math.max(this.stats.worstFix, m);
      }
    }
    if (this.spectating) {
      // Show the race about where the server is now.
      const err = p.serverTick + Math.round(this.rttTicks / 2) - this.world.tick;
      if (Math.abs(err) > 20) this.lead.jump = err;
      this.rate = 1 + Math.max(-0.05, Math.min(0.05, err * 0.01));
    } else if (!first) {
      this.rate = this.lead.update(p.lead, this.rttTicks);
    }
  }

  private serverTickOf(data: Uint8Array): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(1, true);
  }
}
