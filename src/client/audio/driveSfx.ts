// Sounds for the drift boost and slipstream, synthesised like the rest:
// a chime as each drift level is reached, a whoosh when the boost fires, a
// fizzle when a charge is lost, and a soft wind that grows in a slipstream.

import type { CarState } from '../../shared/sim/car.ts';
import { Ev, type EventBuffer } from '../../shared/sim/events.ts';
import type { World } from '../../shared/sim/world.ts';
import type { AudioSystem } from './audio.ts';

function running(audio: AudioSystem): AudioContext | null {
  const ctx = audio.ctx;
  return ctx && ctx.state === 'running' && audio.master ? ctx : null;
}

function send(audio: AudioSystem, node: AudioNode, pan: number, wet = 0): void {
  const ctx = audio.ctx!;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  node.connect(p).connect(audio.master!);
  if (wet > 0 && audio.reverb) {
    const s = ctx.createGain();
    s.gain.value = wet;
    p.connect(s).connect(audio.reverb);
  }
}

function env(ctx: AudioContext, peak: number, t: number, attack: number, len: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}

function noise(audio: AudioSystem, t: number, len: number, rate = 1): AudioBufferSourceNode {
  const src = audio.ctx!.createBufferSource();
  src.buffer = audio.noiseBuffer();
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(t, Math.random() * 0.9);
  src.stop(t + len + 0.05);
  return src;
}

/** A drift level reached: two quick bright notes, higher per level. */
export function playDriftLevel(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const base = [0, 660, 880, 1175][level] ?? 880;
  for (let k = 0; k < 2; k++) {
    const t = ctx.currentTime + k * 0.055;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(base * (k === 0 ? 1 : 1.5), t);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3200;
    o.connect(f);
    send(audio, f.connect(env(ctx, 0.14, t, 0.004, 0.11)), pan, 0.2);
    o.start(t);
    o.stop(t + 0.14);
  }
}

/** The boost fires: a rising whoosh with a low thump, longer and fuller per level. */
export function playDriftBoost(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const len = 0.35 + level * 0.18;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(350, t);
  bp.frequency.exponentialRampToValueAtTime(1800 + level * 500, t + len * 0.6);
  bp.frequency.exponentialRampToValueAtTime(700, t + len);
  send(audio, noise(audio, t, len, 0.9).connect(bp).connect(env(ctx, 0.16 + level * 0.06, t, 0.05, len)), pan, 0.15);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(120, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
  send(audio, o.connect(env(ctx, 0.12 + level * 0.06, t, 0.004, 0.26)), pan);
  o.start(t);
  o.stop(t + 0.3);
}

/** A charge lost to a knock or a spin: a short falling fizzle. */
export function playDriftLost(audio: AudioSystem, pan: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.22);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 1400;
  o.connect(f);
  send(audio, f.connect(env(ctx, 0.1, t, 0.004, 0.24)), pan);
  o.start(t);
  o.stop(t + 0.28);
}

/** A looping soft wind for one player's car, louder the deeper in a slipstream. */
class WindSound {
  private readonly gain: GainNode;
  private readonly filter: BiquadFilterNode;

  constructor(audio: AudioSystem, pan: number) {
    const ctx = audio.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer();
    src.loop = true;
    src.playbackRate.value = 0.7;
    src.start(0, Math.random());
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.Q.value = 0.6;
    this.filter.frequency.value = 700;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    send(audio, src.connect(this.filter).connect(this.gain), pan);
  }

  update(draft: number, speed01: number, now: number): void {
    this.gain.gain.setTargetAtTime(draft * Math.min(1, speed01) * 0.13, now, 0.12);
    this.filter.frequency.setTargetAtTime(500 + draft * 500 + speed01 * 500, now, 0.15);
  }
}

/** Drift and slipstream sounds for the players' own cars. */
export class DriveAudio {
  private winds: WindSound[] = [];

  /** Play this tick's drift events of the players' cars (`players` = their car ids). */
  events(audio: AudioSystem, ev: EventBuffer, players: readonly number[], racing: boolean): void {
    if (!racing || !audio.ready) return;
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if (e.kind !== Ev.DriftLevel && e.kind !== Ev.DriftBoost && e.kind !== Ev.DriftLost) continue;
      const p = players.indexOf(e.car);
      if (p < 0) continue;
      const pan = players.length === 2 ? (p === 0 ? -0.6 : 0.6) : 0;
      if (e.kind === Ev.DriftLevel) playDriftLevel(audio, e.value, pan);
      else if (e.kind === Ev.DriftBoost) playDriftBoost(audio, e.value, pan);
      else playDriftLost(audio, pan);
    }
  }

  /** Each frame: the wind for each player (`players` empty silences it). */
  update(audio: AudioSystem, world: World, players: readonly number[], vTop: number, now: number): void {
    if (!running(audio)) return;
    if (this.winds.length === 0) this.winds = [new WindSound(audio, 0), new WindSound(audio, 0)];
    this.winds.forEach((w, p) => {
      const car: CarState | undefined = world.cars[players[p] ?? -1];
      w.update(car ? car.draft : 0, car ? Math.hypot(car.vx, car.vz) / vTop : 0, now);
    });
  }
}
