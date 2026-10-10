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
