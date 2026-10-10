// Noise-based effects: tyre squeal loop and impact thumps.

import type { AudioSystem } from './audio.ts';

export class SkidSound {
  private readonly gain: GainNode;
  private readonly filter: BiquadFilterNode;

  constructor(audio: AudioSystem) {
    const ctx = audio.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer();
    src.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'bandpass';
    this.filter.frequency.value = 1300;
    this.filter.Q.value = 2.2;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(this.filter).connect(this.gain).connect(audio.master!);
    src.start();
  }

  /** amount 0..1 (how hard the tyres slide); surface pitch multiplier. */
  update(amount: number, pitch: number, now: number): void {
    this.gain.gain.setTargetAtTime(Math.min(1, amount) * 0.22, now, 0.04);
    this.filter.frequency.setTargetAtTime(900 + 900 * pitch + amount * 400, now, 0.05);
  }
}

export function playImpact(audio: AudioSystem, strength: number, pan: number): void {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  src.playbackRate.value = 0.4 + Math.random() * 0.3;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 500 + strength * 60;
  const g = ctx.createGain();
  const vol = Math.min(0.9, 0.15 + strength * 0.04);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.18 + strength * 0.01);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(filter).connect(g).connect(p).connect(audio.master!);
  src.start(now, Math.random() * 0.5);
  src.stop(now + 0.5);
}

/** A short synth tone (beeps, chimes). */
export function playTone(
  audio: AudioSystem, freq: number, duration: number, type: OscillatorType = 'square', volume = 0.15, slideTo = 0, delay = 0,
): void {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.setValueAtTime(volume, t + duration * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g).connect(audio.master!);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Rising arpeggio for crossing the finish line. */
export function playFanfare(audio: AudioSystem, good: boolean): void {
  const notes = good ? [523, 659, 784, 1047, 784, 1047] : [392, 494, 587, 523];
  notes.forEach((f, i) => playTone(audio, f, 0.16, 'square', 0.12, 0, i * 0.12));
}

/** Filtered noise burst with a moving cutoff (whooshes and booms). */
function noiseBurst(
  audio: AudioSystem, duration: number, volume: number, f0: number, f1: number, pan: number,
  type: BiquadFilterType = 'lowpass', rate = 1,
): void {
  const ctx = audio.ctx;
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  src.playbackRate.value = rate;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(f0, now);
  filter.frequency.exponentialRampToValueAtTime(f1, now + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(filter).connect(g).connect(p).connect(audio.master!);
  src.start(now, Math.random() * 0.5);
  src.stop(now + duration + 0.05);
}

/** Missile launch: a bright whoosh. */
export function playLaunch(audio: AudioSystem, volume: number, pan: number): void {
  noiseBurst(audio, 0.45, 0.35 * volume, 4000, 700, pan, 'bandpass', 1.2);
  playTone(audio, 900, 0.25, 'sawtooth', 0.04 * volume, 300);
}

/** Explosion: a low rumbling boom; `size` 1 = missile hit. */
export function playExplosion(audio: AudioSystem, volume: number, pan: number, size = 1): void {
  noiseBurst(audio, 0.6 + size * 0.4, Math.min(1, 0.7 * volume * size), 1800, 80, pan, 'lowpass', 0.5);
  playTone(audio, 110, 0.35, 'triangle', 0.25 * volume, 40);
}

export function playMineDrop(audio: AudioSystem, volume: number): void {
  playTone(audio, 330, 0.05, 'square', 0.08 * volume);
  playTone(audio, 220, 0.07, 'square', 0.08 * volume, 0, 0.06);
}

export function playTurbo(audio: AudioSystem, volume: number): void {
  playTone(audio, 180, 0.6, 'sawtooth', 0.09 * volume, 720);
  noiseBurst(audio, 0.8, 0.25 * volume, 600, 3000, 0, 'bandpass', 1);
}
