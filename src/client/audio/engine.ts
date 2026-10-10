// Synthesised engine. A harmonic-rich wave (and a detuned twin) is chopped by
// a firing-pulse LFO, driven through a soft clipper and a load-dependent
// low-pass: gruff at idle, screaming near the limiter. A fake five-speed
// gearbox drops the revs on upshifts, the limiter bounces when you hold it
// flat out in top gear, and a turbo whistle rides on top when boosting.

import type { AudioSystem } from './audio.ts';

/** Speed (share of top speed) where each gear tops out. */
const GEAR_TOP = [0.2, 0.37, 0.55, 0.76, 1.05];

let wave: PeriodicWave | null = null;
let curve: Float32Array | null = null;

/** A rough V8-ish spectrum: strong low harmonics, some odd ones up high. */
function engineWave(ctx: AudioContext): PeriodicWave {
  if (wave) return wave;
  const n = 24;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k++) imag[k] = (k % 2 ? 1 : 0.55) / Math.pow(k, 0.9) * (k === 2 ? 1.4 : 1);
  wave = ctx.createPeriodicWave(real, imag);
  return wave;
}

function clipCurve(): Float32Array {
  if (curve) return curve;
  curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4);
  }
  return curve;
}

export class EngineSound {
  private readonly ctx: AudioContext;
  private readonly osc1: OscillatorNode;
  private readonly osc2: OscillatorNode;
  private readonly sub: OscillatorNode;
  private readonly pulse: OscillatorNode;
  private readonly pulseDepth: GainNode;
  private readonly body: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly pan: StereoPannerNode;
  private readonly whistle: OscillatorNode;
  private readonly whistleGain: GainNode;
  private rpm = 0.2;
  private gear = 0;
  /** Seconds of "clutch in" after a shift (revs dip, sound thins). */
  private shift = 0;
  private limiter = 0;
  private lastNow = 0;
  private turbo = false;
  /** Called with a strength for exhaust pops on lift-off at high revs. */
  onBackfire: ((strength: number) => void) | null = null;
  private liftTime = 0;

  private readonly far: boolean;

  constructor(audio: AudioSystem, far = false) {
    this.far = far;
    const ctx = audio.ctx!;
    this.ctx = ctx;
    const w = engineWave(ctx);
    this.osc1 = ctx.createOscillator();
    this.osc1.setPeriodicWave(w);
    this.osc2 = ctx.createOscillator();
    this.osc2.setPeriodicWave(w);
    this.osc2.detune.value = 9;
    this.sub = ctx.createOscillator();
    this.sub.type = 'triangle';
    // Firing pulses: amplitude modulation at the firing rate gives the chug.
    this.pulse = ctx.createOscillator();
    this.pulse.type = 'square';
    this.pulseDepth = ctx.createGain();
    this.pulseDepth.gain.value = 0.35;
    this.body = ctx.createGain();
    this.body.gain.value = 0.65;
    this.pulse.connect(this.pulseDepth).connect(this.body.gain);
    const shaper = ctx.createWaveShaper();
    shaper.curve = clipCurve() as Float32Array<ArrayBuffer>;
    shaper.oversample = far ? 'none' : '2x';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.Q.value = 2.2;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    const mix1 = ctx.createGain();
    mix1.gain.value = 0.5;
    const mix2 = ctx.createGain();
    mix2.gain.value = 0.35;
    const mixSub = ctx.createGain();
    mixSub.gain.value = 0.6;
    this.osc1.connect(mix1).connect(this.body);
    this.osc2.connect(mix2).connect(this.body);
    this.sub.connect(mixSub).connect(this.body);
    this.body.connect(shaper).connect(this.filter).connect(this.gain).connect(this.pan).connect(audio.master!);
    // Turbo whistle.
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle.connect(this.whistleGain).connect(this.pan);
    for (const o of [this.osc1, this.osc2, this.sub, this.pulse, this.whistle]) o.start();
  }

  /**
   * speed01: speed / top speed (or a rev target on the grid); throttle 0..1;
   * volume 0..1; pan -1..1; doppler pitch factor (1 = none); turbo boosting;
   * wheelspin 0..1 (drifting: the revs flare above road speed).
   */
  update(speed01: number, throttle: number, volume: number, pan: number, now: number, doppler = 1, turbo = false, wheelspin = 0): void {
    const dt = Math.min(0.1, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    // Gearbox: shift up at the top of a gear, down with some hysteresis.
    let g = this.gear;
    if (g < GEAR_TOP.length - 1 && speed01 > GEAR_TOP[g]) {
      g++;
      this.shift = 0.12;
    } else if (g > 0 && speed01 < GEAR_TOP[g - 1] * 0.88) {
      g--;
    }
    this.gear = g;
    const lo = g === 0 ? 0 : GEAR_TOP[g - 1] * 0.7;
    const inGear = Math.min(1.05, Math.max(0, (speed01 - lo) / (GEAR_TOP[g] - lo)));
    let target = 0.18 + 0.8 * inGear + throttle * 0.08 + wheelspin * throttle * 0.16;
    if (this.shift > 0) {
      this.shift -= dt;
      target *= 0.82;
    }
    // Rev limiter: flat out against the top of the last gear.
    if (throttle > 0.8 && target > 1.0) {
      this.limiter += dt * 28;
      target = 0.97 + 0.04 * Math.sin(this.limiter);
    }
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 9 : 5));
    // Lifting off at high revs: exhaust pops.
    if (throttle < 0.2 && this.rpm > 0.65) {
      this.liftTime += dt;
      if (this.liftTime < 0.6 && Math.random() < dt * 9) this.onBackfire?.(this.rpm);
    } else {
      this.liftTime = 0;
    }
    const f = (32 + this.rpm * 108) * doppler;
    const k = 0.04;
    this.osc1.frequency.setTargetAtTime(f, now, k);
    this.osc2.frequency.setTargetAtTime(f * 1.003, now, k);
    this.sub.frequency.setTargetAtTime(f * 0.5, now, k);
    this.pulse.frequency.setTargetAtTime(f * 0.5, now, k);
    const load = this.shift > 0 ? 0.25 : throttle;
    this.pulseDepth.gain.setTargetAtTime(0.18 + 0.3 * (1 - this.rpm), now, 0.05);
    this.filter.frequency.setTargetAtTime(220 + this.rpm * (900 + 1700 * load), now, 0.04);
    const base = this.far ? 0.12 : 0.1;
    this.gain.gain.setTargetAtTime(volume * (base + 0.07 * load + 0.05 * this.rpm), now, 0.05);
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.05);
    // Turbo: a whistle that rises with revs; a falling "pssh" tail when it ends.
    if (!this.far) {
      if (turbo) {
        this.whistle.frequency.setTargetAtTime(1800 + this.rpm * 1600, now, 0.15);
        this.whistleGain.gain.setTargetAtTime(volume * 0.035, now, 0.08);
      } else {
        if (this.turbo) this.whistle.frequency.setTargetAtTime(600, now, 0.25);
        this.whistleGain.gain.setTargetAtTime(0, now, 0.18);
      }
      this.turbo = turbo;
    }
  }

  silence(now: number): void {
    this.gain.gain.setTargetAtTime(0, now, 0.05);
    this.whistleGain.gain.setTargetAtTime(0, now, 0.05);
  }
}
