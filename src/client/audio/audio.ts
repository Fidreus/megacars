// Web Audio setup. Browsers only allow sound after a user gesture, so the
// context is created on the first key press or click.

export class AudioSystem {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
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
      master.connect(comp).connect(ctx.destination);
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
