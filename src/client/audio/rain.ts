// Rain sound, synthesised like the rest: a hiss of drops that follows how
// hard it rains, a softer patter on the car, and rolling thunder now and
// then. On snow tracks only a low wind.

import type { AudioSystem } from './audio.ts';

export class RainSound {
  private readonly audio: AudioSystem;
  private readonly hiss: GainNode;
  private readonly patter: GainNode;
  private readonly wind: GainNode;

  constructor(audio: AudioSystem) {
    const ctx = audio.ctx!;
    this.audio = audio;
    const loop = (rate: number) => {
      const s = ctx.createBufferSource();
      s.buffer = audio.noiseBuffer();
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * 0.9);
      return s;
    };
    // Hiss: bright band of noise.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    this.hiss = ctx.createGain();
    this.hiss.gain.value = 0;
    loop(1).connect(hp).connect(lp).connect(this.hiss).connect(audio.master!);
    // Patter: lower, chopped by a fast flutter like drops on the bodywork.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.8;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    const flutter = ctx.createOscillator();
    flutter.type = 'square';
    flutter.frequency.value = 23;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    flutter.connect(depth).connect(am.gain);
    flutter.start();
    this.patter = ctx.createGain();
    this.patter.gain.value = 0;
    loop(0.7).connect(bp).connect(am).connect(this.patter).connect(audio.master!);
    // Wind for snow: low noise with a slow swell.
    const wl = ctx.createBiquadFilter();
    wl.type = 'lowpass';
    wl.frequency.value = 420;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.13;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 180;
    swell.connect(swellDepth).connect(wl.frequency);
    swell.start();
    this.wind = ctx.createGain();
    this.wind.gain.value = 0;
    loop(0.4).connect(wl).connect(this.wind).connect(audio.master!);
  }

  /** `rain` 0..1; `thunder` > 0 plays a clap of that strength. */
  update(rain: number, snow: boolean, thunder: number, now: number): void {
    const r = snow ? 0 : rain;
    this.hiss.gain.setTargetAtTime(r * 0.06, now, 0.4);
    this.patter.gain.setTargetAtTime(r * 0.035, now, 0.4);
    this.wind.gain.setTargetAtTime((snow ? rain : 0) * 0.09, now, 0.6);
    if (thunder > 0) this.thunder(thunder);
  }

  /** A low rumble that rolls in, with a crack when it is close. */
  private thunder(size: number): void {
    const ctx = this.audio.ctx;
    if (!ctx || ctx.state !== 'running' || !this.audio.master) return;
    const t = ctx.currentTime;
    const len = 2.5 + size * 2;
    const src = ctx.createBufferSource();
    src.buffer = this.audio.noiseBuffer();
    src.loop = true;
    src.playbackRate.value = 0.25;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(140 + size * 220, t);
    lp.frequency.exponentialRampToValueAtTime(70, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + size * 0.45, t + 0.08 + (1 - size) * 0.5);
    // Rolls: a second swell, then it dies away.
    g.gain.exponentialRampToValueAtTime(0.12 + size * 0.15, t + len * 0.35);
    g.gain.exponentialRampToValueAtTime(0.2 + size * 0.2, t + len * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(lp).connect(g).connect(this.audio.master);
    if (this.audio.reverb) g.connect(this.audio.reverb);
    src.start(t, Math.random() * 0.9);
    src.stop(t + len + 0.1);
    if (size > 0.7) {
      const c = ctx.createBufferSource();
      c.buffer = this.audio.noiseBuffer();
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, t);
      cg.gain.exponentialRampToValueAtTime(0.18 * size, t + 0.01);
      cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      c.connect(hp).connect(cg).connect(this.audio.master);
      c.start(t, Math.random() * 0.5);
      c.stop(t + 0.4);
    }
  }
}
