// Sounds for item crates: a short bright arpeggio and sparkle when a crate is
// taken (full for the local players, quieter for cars close by) and a soft
// two-note blip when one comes back near a local player.

import { Ev, type EventBuffer } from '../../shared/sim/events.ts';
import type { World } from '../../shared/sim/world.ts';
import type { AudioSystem } from './audio.ts';

function running(audio: AudioSystem): AudioContext | null {
  const ctx = audio.ctx;
  return ctx && ctx.state === 'running' && audio.master ? ctx : null;
}

function out(audio: AudioSystem, node: AudioNode, pan: number, wet: number): void {
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

function tone(audio: AudioSystem, type: OscillatorType, freq: number, t: number, len: number, peak: number, pan: number, wet: number): void {
  const ctx = audio.ctx!;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 4200;
  out(audio, o.connect(f).connect(g), pan, wet);
  o.start(t);
  o.stop(t + len + 0.02);
}

/** A crate taken: three quick rising notes over a crack of noise. `level` 0-1. */
export function playCratePickup(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  [988, 1319, 1976].forEach((f, k) => tone(audio, 'square', f, t + k * 0.045, 0.1, 0.15 * level, pan, 0.25));
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  src.playbackRate.value = 1.4;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16 * level, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  out(audio, src.connect(hp).connect(g), pan, 0.1);
  src.start(t, Math.random() * 0.5);
  src.stop(t + 0.15);
}

/** A crate back: a soft, low two-note blip. */
export function playCrateBack(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  tone(audio, 'triangle', 660, t, 0.09, 0.035 * level, pan, 0.3);
  tone(audio, 'triangle', 990, t + 0.07, 0.12, 0.03 * level, pan, 0.3);
}

/** Play the crate sounds for this tick's events, heard from the first local player's car. */
export function crateSounds(audio: AudioSystem, w: World, ev: EventBuffer, players: readonly number[], racing: boolean): void {
  if (!racing || !audio.ready) return;
  const me = w.cars[players[0]];
  if (!me) return;
  for (let k = 0; k < ev.count; k++) {
    const e = ev.list[k];
    if (e.kind !== Ev.CratePickup && e.kind !== Ev.CrateBack) continue;
    const dx = e.x - me.x;
    const near = Math.max(0, 1 - Math.hypot(dx, e.z - me.z) / 60);
    if (e.kind === Ev.CratePickup) playCratePickup(audio, players.includes(e.car) ? 1 : near * 0.4, players.includes(e.car) ? 0 : dx / 30);
    else playCrateBack(audio, near, dx / 30);
  }
}
