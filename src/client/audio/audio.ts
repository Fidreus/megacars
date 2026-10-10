// Web Audio setup. Browsers only allow sound after a user gesture, so the
// context is created on the first key press or click.

export class AudioSystem {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  /**
   * Final mix: sound effects (after their compressor) and music meet here,
   * then a brick-wall limiter and a soft clipper keep the sum below full
   * scale. Without it loud moments (race start: beeps, cheering, engines and
   * music at once) went over 1.0 and crackled.
   */
  bus: GainNode | null = null;
  /** Feed a node into this for reverb (in addition to master). */
  reverb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;

  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const master = ctx.createGain();
      master.gain.value = this.volume;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      const bus = ctx.createGain();
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.12;
      const clip = ctx.createWaveShaper();
      clip.curve = softClip() as Float32Array<ArrayBuffer>;
      clip.oversample = '2x';
      bus.connect(limiter).connect(clip).connect(ctx.destination);
      master.connect(comp).connect(bus);
      this.bus = bus;
      // Reverb send: a short, bright "stadium" tail for bangs and beeps.
      const conv = ctx.createConvolver();
      conv.buffer = impulse(ctx, 1.4, 2.6);
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      const send = ctx.createGain();
      send.connect(conv).connect(wet).connect(master);
      this.ctx = ctx;
      this.master = master;
      this.reverb = send;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** One second of white noise, shared by all noise-based sounds. */
  noiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < d.length; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647) * 2 - 1;
      }
    }
    return this.noise;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  private analyser: AnalyserNode | null = null;
  private peakTap: AnalyserNode | null = null;

  /** Highest sample in the final mix (before the limiter) over the last ~40 ms. */
  peak(): number {
    if (!this.ctx || !this.bus) return 0;
    if (!this.peakTap) {
      this.peakTap = this.ctx.createAnalyser();
      this.peakTap.fftSize = 2048;
      this.bus.connect(this.peakTap);
    }
    const buf = new Float32Array(this.peakTap.fftSize);
    this.peakTap.getFloatTimeDomainData(buf);
    let m = 0;
    for (const v of buf) m = Math.max(m, Math.abs(v));
    return m;
  }

  /** RMS level of the sound effects right now (debugging/tests). */
  level(): number {
    if (!this.ctx || !this.master) return 0;
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.master.connect(this.analyser);
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }
}

/** Stereo exponentially decaying noise: a cheap outdoor-ish impulse response. */
function impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 7;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647) * 2 - 1;
      // A few early reflections, then a smooth tail.
      const early = i < ctx.sampleRate * 0.08 && i % 997 < 30 ? 0.6 : 0;
      d[i] = (n + early) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/** Unity below 0.8, then a smooth knee that never quite reaches 1. */
function softClip(): Float32Array {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
    c[i] = Math.sign(x) * y;
  }
  return c;
}
