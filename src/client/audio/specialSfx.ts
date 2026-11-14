// Sounds for the special items: a rising whine for a homing missile, a wet
// glug for an oil slick, a shimmer for a shield going up and a bright
// "ting" when a hit bounces off it, a squelch for a car on a slick, and the
// lock warning: beeps that come faster as a homing missile closes in.

import { Ev, type EventBuffer } from '../../shared/sim/events.ts';
import { SPECIAL } from '../../shared/sim/specials.ts';
import { ShotKind } from '../../shared/sim/weapons.ts';
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

/** One oscillator with a pitch glide from f0 to f1 and a quick attack. */
function sweep(audio: AudioSystem, type: OscillatorType, f0: number, f1: number, t: number, len: number, peak: number, pan: number, wet = 0.2, cut = 5000): void {
  const ctx = audio.ctx!;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cut;
  out(audio, o.connect(f).connect(g), pan, wet);
  o.start(t);
  o.stop(t + len + 0.02);
}

function noise(audio: AudioSystem, t: number, len: number, peak: number, pan: number, type: BiquadFilterType, freq: number, rate = 1): void {
  const ctx = audio.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  out(audio, src.connect(f).connect(g), pan, 0.15);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.02);
}

/** Homing missile away: a rising two-tone whine over a rocket hiss. */
export function playHomingLaunch(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  sweep(audio, 'sawtooth', 300, 1400, t, 0.45, 0.18 * level, pan, 0.25, 2600);
  sweep(audio, 'square', 450, 2100, t + 0.04, 0.4, 0.09 * level, pan, 0.25, 3000);
  noise(audio, t, 0.5, 0.3 * level, pan, 'bandpass', 1800, 0.8);
}

/** Oil slick dropped: a wet, low glug. */
export function playOilDrop(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  sweep(audio, 'sine', 240, 70, t, 0.22, 0.14 * level, pan, 0.1);
  sweep(audio, 'sine', 180, 60, t + 0.09, 0.2, 0.1 * level, pan, 0.1);
  noise(audio, t, 0.25, 0.1 * level, pan, 'lowpass', 700, 0.6);
}

/** A car slithers onto a slick: a short squelch. */
export function playOilSlip(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  noise(audio, t, 0.3, 0.2 * level, pan, 'bandpass', 900, 0.5);
  sweep(audio, 'triangle', 500, 180, t, 0.18, 0.08 * level, pan, 0.1);
}

/** Shield up: a rising shimmer of three notes. */
export function playShieldUp(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  [523, 784, 1047].forEach((f, k) => sweep(audio, 'triangle', f, f * 1.5, t + k * 0.05, 0.35, 0.12 * level, pan, 0.45));
  sweep(audio, 'sine', 2093, 3136, t + 0.12, 0.4, 0.05 * level, pan, 0.5);
}

/** A hit bouncing off a shield: a bright metallic ting and a short zap. */
export function playShieldBlock(audio: AudioSystem, level: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || level <= 0.02) return;
  const t = ctx.currentTime;
  sweep(audio, 'sine', 2600, 1700, t, 0.5, 0.11 * level, pan, 0.5, 8000);
  sweep(audio, 'sine', 3900, 2400, t, 0.35, 0.05 * level, pan, 0.5, 8000);
  sweep(audio, 'square', 900, 200, t, 0.12, 0.04 * level, pan, 0.2, 3000);
  noise(audio, t, 0.15, 0.1 * level, pan, 'highpass', 3000, 1.3);
}

/** One beep of the lock warning. */
function playLockBeep(audio: AudioSystem, urgency: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const f = 1200 + urgency * 800;
  sweep(audio, 'square', f, f, t, 0.09, 0.14 + 0.08 * urgency, 0, 0, 4000);
}

/** Play the special item sounds for this tick's events, heard from the first local player's car. */
export function specialSounds(audio: AudioSystem, w: World, ev: EventBuffer, players: readonly number[], racing: boolean): void {
  if (!racing || !audio.ready) return;
  const me = w.cars[players[0]];
  if (!me) return;
  for (let k = 0; k < ev.count; k++) {
    const e = ev.list[k];
    const homing = e.kind === Ev.Fire && e.other === ShotKind.Homing;
    const oil = e.kind === Ev.Fire && e.other === ShotKind.Oil;
    if (!homing && !oil && e.kind !== Ev.ShieldUp && e.kind !== Ev.ShieldBlock && e.kind !== Ev.OilSlip) continue;
    const dx = e.x - me.x;
    const mine = players.includes(e.car);
    const level = mine ? 1 : Math.max(0, 1 - Math.hypot(dx, e.z - me.z) / 90);
    const pan = mine ? 0 : dx / 40;
    if (homing) playHomingLaunch(audio, level, pan);
    else if (oil) playOilDrop(audio, level, pan);
    else if (e.kind === Ev.ShieldUp) playShieldUp(audio, level, pan);
    else if (e.kind === Ev.ShieldBlock) playShieldBlock(audio, level, pan);
    else playOilSlip(audio, level * 0.8, pan);
  }
}

/** Seconds until the next lock beep, per local player slot. */
const nextBeep: number[] = [];

/**
 * The lock warning for every local player: call once per frame. Beeps every
 * 0.5 s for a missile at full range, down to every 0.08 s when it is close.
 */
export function lockBeeps(audio: AudioSystem, w: World, players: readonly number[], dt: number, racing: boolean): void {
  players.forEach((id, p) => {
    const car = w.cars[id];
    let best = Infinity;
    for (const s of w.shots) {
      if (s.kind === ShotKind.Homing && s.target === id) best = Math.min(best, Math.hypot(s.x - car.x, s.z - car.z));
    }
    if (!racing || best === Infinity) {
      nextBeep[p] = 0;
      return;
    }
    const close = Math.max(0, Math.min(1, 1 - best / SPECIAL.lockRange));
    nextBeep[p] = (nextBeep[p] ?? 0) - dt;
    if (nextBeep[p] > 0) return;
    nextBeep[p] = 0.5 - 0.42 * close;
    if (audio.ready) playLockBeep(audio, close);
  });
}
