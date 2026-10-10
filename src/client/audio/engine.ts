// Synthesised engine: a sawtooth and a sub-octave square through a low-pass
// filter, pitched by a fake gearbox. Crunchy, buzzy and suitably 16-bit.

import type { AudioSystem } from './audio.ts';

const GEARS = [0, 0.19, 0.36, 0.54, 0.74, 1.02];

export class EngineSound {
  private readonly osc1: OscillatorNode;
  private readonly osc2: OscillatorNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;
  private rpm = 0;

  constructor(audio: AudioSystem) {
    const ctx = audio.ctx!;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 3;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    const sub = ctx.createGain();
    sub.gain.value = 0.55;
    this.osc1.connect(this.filter);
    this.osc2.connect(sub).connect(this.filter);
    this.filter.connect(this.gain).connect(this.pan).connect(audio.master!);
    this.osc1.start();
    this.osc2.start();
  }

  /** speed01: speed / top speed; throttle 0..1; volume 0..1; pan -1..1. */
  update(speed01: number, throttle: number, volume: number, pan: number, now: number): void {
    let g = 0;
    while (g < GEARS.length - 2 && speed01 > GEARS[g + 1]) g++;
    const lo = GEARS[g];
    const hi = GEARS[g + 1];
    const inGear = Math.min(1, Math.max(0, (speed01 - lo) / (hi - lo)));
    const target = 0.22 + 0.78 * inGear + throttle * 0.06;
    this.rpm += (target - this.rpm) * 0.25;
    const f = 34 + this.rpm * 96;
    const t = now + 0.03;
    this.osc1.frequency.setTargetAtTime(f, now, 0.02);
    this.osc2.frequency.setTargetAtTime(f * 0.5 * 1.004, now, 0.02);
    this.filter.frequency.setTargetAtTime(260 + this.rpm * 1500 * (0.45 + 0.55 * throttle), now, 0.03);
    this.gain.gain.setTargetAtTime(volume * (0.09 + 0.08 * throttle + 0.05 * this.rpm), now, 0.04);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.05);
  }

  silence(now: number): void {
    this.gain.gain.setTargetAtTime(0, now, 0.05);
  }
}
