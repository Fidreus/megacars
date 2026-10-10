// Web Audio setup. Browsers only allow sound after a user gesture, so the
// context is created on the first key press or click.

export class AudioSystem {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
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
      this.ctx = ctx;
      this.master = master;
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
    if (this.master) this.master.gain.value = v;
  }
}
