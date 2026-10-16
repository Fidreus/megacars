// Sound effects, all synthesised: tyres per surface, road rumble, crashes,
// explosions, weapons, jumps, crowd, countdown and menu blips. Bangs get a
// touch of the reverb send so they sit in an outdoor arena.

import type { AudioSystem } from './audio.ts';

const R = Math.random;

/** Envelope helper: a gain that starts at `peak` and decays exponentially. */
function decayGain(ctx: AudioContext, peak: number, t: number, len: number, attack = 0.003): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
}

function panner(ctx: AudioContext, pan: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  return p;
}

/** Route to master, plus some reverb. */
function out(audio: AudioSystem, node: AudioNode, wet = 0): void {
  node.connect(audio.master!);
  if (wet > 0 && audio.reverb) {
    const s = audio.ctx!.createGain();
    s.gain.value = wet;
    node.connect(s).connect(audio.reverb);
  }
}

function running(audio: AudioSystem): AudioContext | null {
  const ctx = audio.ctx;
  return ctx && ctx.state === 'running' && audio.master ? ctx : null;
}

function noise(audio: AudioSystem, t: number, len: number, rate = 1): AudioBufferSourceNode {
  const ctx = audio.ctx!;
  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  src.loop = true;
  src.playbackRate.value = rate;
  src.start(t, R() * 0.9);
  src.stop(t + len + 0.05);
  return src;
}

function tone(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, t: number, len: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + len);
  o.start(t);
  o.stop(t + len + 0.05);
  return o;
}

// ------------------------------------------------------------------ tyres

/** Surface families for tyre sounds. */
export const TyreSurface = { Paved: 0, Loose: 1, Grass: 2, Water: 3, Ice: 4 } as const;

/**
 * Looping tyre and road sounds for one car: tonal squeal on tarmac, crunch on
 * gravel/sand/snow, a soft rumble on grass, hiss in water, and road noise
 * that grows with speed.
 */
export class TyreSound {
  private readonly squealGain: GainNode;
  private readonly squealFilter: BiquadFilterNode;
  private readonly squealLfo: OscillatorNode;
  private readonly crunchGain: GainNode;
  private readonly crunchFilter: BiquadFilterNode;
  private readonly crunchAm: GainNode;
  private readonly rumbleGain: GainNode;
  private readonly hissGain: GainNode;
  private readonly roadGain: GainNode;
  private readonly roadFilter: BiquadFilterNode;
  private readonly whine: OscillatorNode[];
  private readonly whineGain: GainNode;
  private readonly scrubGain: GainNode;
  private readonly scrubFilter: BiquadFilterNode;

  constructor(audio: AudioSystem) {
    const ctx = audio.ctx!;
    const loop = (rate: number) => {
      const s = ctx.createBufferSource();
      s.buffer = audio.noiseBuffer();
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, R());
      return s;
    };
    // Squeal: narrow band-pass noise with a wobbling centre (rubber chatter).
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.Q.value = 9;
    this.squealFilter.frequency.value = 1500;
    this.squealLfo = ctx.createOscillator();
    this.squealLfo.frequency.value = 11;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 70;
    this.squealLfo.connect(lfoDepth).connect(this.squealFilter.frequency);
    this.squealLfo.start();
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    // Squeal noise, spread a little in stereo for width.
    const spread = ctx.createChannelMerger(2);
    loop(1).connect(this.squealFilter).connect(this.squealGain);
    this.squealGain.connect(spread, 0, 0);
    const late = ctx.createDelay(0.05);
    late.delayTime.value = 0.011;
    this.squealGain.connect(late).connect(spread, 0, 1);
    out(audio, spread, 0.25);
    // Tonal whine: a rubber "eeee" with a couple of harmonics, chattering.
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    const chatter = ctx.createGain();
    chatter.gain.value = 0.7;
    const chatLfo = ctx.createOscillator();
    chatLfo.type = 'triangle';
    chatLfo.frequency.value = 27;
    const chatDepth = ctx.createGain();
    chatDepth.gain.value = 0.3;
    chatLfo.connect(chatDepth).connect(chatter.gain);
    chatLfo.start();
    const whineBp = ctx.createBiquadFilter();
    whineBp.type = 'bandpass';
    whineBp.frequency.value = 1500;
    whineBp.Q.value = 1.2;
    this.whine = [1, 2.01, 3.02].map((h, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = 800 * h;
      const g = ctx.createGain();
      g.gain.value = [0.6, 0.3, 0.15][i];
      o.connect(g).connect(chatter);
      o.start();
      return o;
    });
    // Slow wander of the pitch, like a real tyre.
    const wander = ctx.createOscillator();
    wander.frequency.value = 3.1;
    const wanderDepth = ctx.createGain();
    wanderDepth.gain.value = 25;
    wander.connect(wanderDepth);
    for (const o of this.whine) wanderDepth.connect(o.frequency);
    wander.start();
    chatter.connect(whineBp).connect(this.whineGain);
    out(audio, this.whineGain, 0.3);
    // Scrub: the low, gritty sound of a tyre dragged sideways.
    this.scrubFilter = ctx.createBiquadFilter();
    this.scrubFilter.type = 'lowpass';
    this.scrubFilter.frequency.value = 500;
    this.scrubGain = ctx.createGain();
    this.scrubGain.gain.value = 0;
    loop(0.45).connect(this.scrubFilter).connect(this.scrubGain).connect(audio.master!);
    // Crunch: low-passed noise, chopped by a fast random-ish AM.
    this.crunchFilter = ctx.createBiquadFilter();
    this.crunchFilter.type = 'lowpass';
    this.crunchFilter.frequency.value = 1400;
    this.crunchAm = ctx.createGain();
    const chop = ctx.createOscillator();
    chop.type = 'square';
    chop.frequency.value = 23;
    const chopDepth = ctx.createGain();
    chopDepth.gain.value = 0.45;
    chop.connect(chopDepth).connect(this.crunchAm.gain);
    chop.start();
    this.crunchGain = ctx.createGain();
    this.crunchGain.gain.value = 0;
    loop(0.7).connect(this.crunchFilter).connect(this.crunchAm).connect(this.crunchGain).connect(audio.master!);
    // Grass rumble.
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 320;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    loop(0.5).connect(rf).connect(this.rumbleGain).connect(audio.master!);
    // Water hiss.
    const hf = ctx.createBiquadFilter();
    hf.type = 'highpass';
    hf.frequency.value = 2500;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    loop(1.2).connect(hf).connect(this.hissGain).connect(audio.master!);
    // Road noise: a low roar that opens up with speed.
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 200;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    loop(0.6).connect(this.roadFilter).connect(this.roadGain).connect(audio.master!);
  }

  /** slide 0..1, speed01 0..1 (of top speed), surface family, airborne. */
  update(slide: number, speed01: number, surface: number, airborne: boolean, now: number): void {
    const k = 0.05;
    const on = airborne ? 0 : 1;
    const paved = surface === TyreSurface.Paved;
    // A curve so light slides whisper and a full drift really screams.
    const sq = paved ? on * Math.pow(slide, 0.8) : 0;
    this.squealGain.gain.setTargetAtTime(sq * 0.24, now, k);
    this.squealFilter.frequency.setTargetAtTime(1100 + slide * 700 + speed01 * 300, now, 0.08);
    const whineOn = paved || surface === TyreSurface.Ice ? on * Math.max(0, slide - 0.12) / 0.88 : 0;
    this.whineGain.gain.setTargetAtTime(whineOn * (surface === TyreSurface.Ice ? 0.05 : 0.11), now, k);
    const pitch = 720 + slide * 260 + speed01 * 180;
    this.whine.forEach((o, i) => o.frequency.setTargetAtTime(pitch * [1, 2.01, 3.02][i], now, 0.12));
    this.scrubGain.gain.setTargetAtTime(on * slide * Math.min(1, speed01 * 3) * (paved ? 0.16 : 0.08), now, k);
    this.scrubFilter.frequency.setTargetAtTime(300 + speed01 * 700, now, 0.1);
    const loose = surface === TyreSurface.Loose;
    this.crunchGain.gain.setTargetAtTime(loose ? on * (0.05 + slide * 0.18) * Math.min(1, speed01 * 3) : 0, now, k);
    this.crunchFilter.frequency.setTargetAtTime(700 + speed01 * 1600, now, 0.1);
    this.rumbleGain.gain.setTargetAtTime(surface === TyreSurface.Grass ? on * Math.min(1, speed01 * 2.5) * 0.22 : 0, now, k);
    this.hissGain.gain.setTargetAtTime(surface === TyreSurface.Water ? on * Math.min(1, speed01 * 2) * 0.12 : 0, now, k);
    this.roadGain.gain.setTargetAtTime(on * speed01 * speed01 * 0.09, now, 0.1);
    this.roadFilter.frequency.setTargetAtTime(160 + speed01 * 600, now, 0.1);
  }

  silence(now: number): void {
    for (const g of [this.squealGain, this.whineGain, this.scrubGain, this.crunchGain, this.rumbleGain, this.hissGain, this.roadGain]) {
      g.gain.setTargetAtTime(0, now, 0.05);
    }
  }
}

// ---------------------------------------------------------------- crashes

/** Car hitting a wall or another car: thump + crunch + a metallic ring. */
export function playImpact(audio: AudioSystem, strength: number, pan: number, metal = 0.6): void {
  const ctx = running(audio);
  if (!ctx || strength < 0.5) return;
  const t = ctx.currentTime;
  const s = Math.min(1, strength / 14);
  const p = panner(ctx, pan);
  out(audio, p, 0.15 + s * 0.3);
  // Low thump.
  tone(ctx, 'sine', 120 + s * 40, 45, t, 0.18).connect(decayGain(ctx, 0.25 + s * 0.6, t, 0.2)).connect(p);
  // Crunch.
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900 + R() * 900;
  bp.Q.value = 0.9;
  noise(audio, t, 0.25, 0.6 + R() * 0.4).connect(bp).connect(decayGain(ctx, 0.15 + s * 0.6, t, 0.12 + s * 0.2)).connect(p);
  // Bodywork ringing: a few inharmonic partials.
  if (s > 0.15) {
    const base = 340 + R() * 260;
    for (const r of [1, 2.76, 5.4]) {
      tone(ctx, 'triangle', base * r, base * r * 0.97, t, 0.4).connect(decayGain(ctx, metal * s * 0.08 / r, t, 0.25 + s * 0.3)).connect(p);
    }
  }
}

// ------------------------------------------------------------- explosions

/** Boom: sub drop, roaring low-pass noise, a crackling tail. `size` 1 = missile hit. */
export function playExplosion(audio: AudioSystem, volume: number, pan: number, size = 1): void {
  const ctx = running(audio);
  if (!ctx || volume <= 0) return;
  const t = ctx.currentTime;
  const v = Math.min(1, volume);
  const p = panner(ctx, pan);
  out(audio, p, 0.5);
  tone(ctx, 'sine', 95, 28, t, 0.6 * size).connect(decayGain(ctx, 0.9 * v, t, 0.7 * size, 0.005)).connect(p);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3500, t);
  lp.frequency.exponentialRampToValueAtTime(150, t + 0.9 * size);
  noise(audio, t, 1.2 * size, 0.55).connect(lp).connect(decayGain(ctx, 0.8 * v, t, 1.1 * size, 0.004)).connect(p);
  // Crackles: little clicks scattered over the tail.
  for (let i = 0; i < 10 * size; i++) {
    const tc = t + 0.05 + R() * 0.7 * size;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    noise(audio, tc, 0.03, 1.5).connect(hp).connect(decayGain(ctx, 0.12 * v * R(), tc, 0.025, 0.001)).connect(p);
  }
}

/** Bits of car raining down after a wreck. */
export function playDebris(audio: AudioSystem, volume: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx || volume <= 0) return;
  const t = ctx.currentTime;
  const p = panner(ctx, pan);
  out(audio, p, 0.3);
  for (let i = 0; i < 9; i++) {
    const tc = t + 0.25 + R() * 1.1;
    const f = 600 + R() * 1800;
    tone(ctx, 'square', f, f * 0.9, tc, 0.08).connect(decayGain(ctx, 0.05 * volume, tc, 0.07, 0.001)).connect(p);
  }
}

/** Exhaust pop when lifting off at high revs. */
export function playBackfire(audio: AudioSystem, strength: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const p = panner(ctx, pan);
  out(audio, p, 0.2);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900 + R() * 600;
  noise(audio, t, 0.08, 0.5).connect(lp).connect(decayGain(ctx, 0.25 * strength, t, 0.07, 0.001)).connect(p);
  tone(ctx, 'sine', 140, 60, t, 0.06).connect(decayGain(ctx, 0.2 * strength, t, 0.06, 0.001)).connect(p);
}

// ---------------------------------------------------------------- weapons

/** Missile launch: a bright whoosh and a rocket hiss that flies away. */
export function playLaunch(audio: AudioSystem, volume: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const p = panner(ctx, pan);
  out(audio, p, 0.25);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(5000, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + 0.6);
  noise(audio, t, 0.7, 1.3).connect(bp).connect(decayGain(ctx, 0.45 * volume, t, 0.65, 0.01)).connect(p);
  tone(ctx, 'sawtooth', 1100, 260, t, 0.3).connect(decayGain(ctx, 0.05 * volume, t, 0.3)).connect(p);
  tone(ctx, 'sine', 70, 40, t, 0.12).connect(decayGain(ctx, 0.3 * volume, t, 0.12)).connect(p);
}

export function playMineDrop(audio: AudioSystem, volume: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  out(audio, tone(ctx, 'square', 160, 120, t, 0.06).connect(decayGain(ctx, 0.12 * volume, t, 0.06)), 0.1);
  // Arming beeps.
  for (let i = 0; i < 2; i++) {
    const tb = t + 0.12 + i * 0.16;
    out(audio, tone(ctx, 'square', 1400, 1400, tb, 0.04).connect(decayGain(ctx, 0.05 * volume, tb, 0.04, 0.001)));
  }
}

/**
 * Turbo / nitro boost for `secs`: a deep "whoomp" as it lights, a fluttering
 * jet roar that climbs while it burns, and a blow-off "pssh" at the end.
 */
export function playTurbo(audio: AudioSystem, volume: number, secs = 1.5): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const end = t + secs;
  // Ignition: low thump plus a dull pop.
  out(audio, tone(ctx, 'sine', 110, 42, t, 0.3).connect(decayGain(ctx, 0.45 * volume, t, 0.32, 0.004)), 0.2);
  const pop = ctx.createBiquadFilter();
  pop.type = 'lowpass';
  pop.frequency.value = 700;
  out(audio, noise(audio, t, 0.2, 0.6).connect(pop).connect(decayGain(ctx, 0.35 * volume, t, 0.18, 0.002)), 0.2);
  // The burn: band-passed noise sweeping up, with a fast flutter like a flame.
  const roar = ctx.createBiquadFilter();
  roar.type = 'bandpass';
  roar.Q.value = 1.4;
  roar.frequency.setValueAtTime(380, t);
  roar.frequency.exponentialRampToValueAtTime(1400, end);
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 2600;
  const flutter = ctx.createGain();
  flutter.gain.value = 0.75;
  const lfo = ctx.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.setValueAtTime(26, t);
  lfo.frequency.linearRampToValueAtTime(38, end);
  const depth = ctx.createGain();
  depth.gain.value = 0.25;
  lfo.connect(depth).connect(flutter.gain);
  lfo.start(t);
  lfo.stop(end + 0.4);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(0.32 * volume, t + 0.12);
  env.gain.setValueAtTime(0.32 * volume, end - 0.25);
  env.gain.exponentialRampToValueAtTime(0.0001, end + 0.15);
  out(audio, noise(audio, t, secs + 0.2, 0.8).connect(roar).connect(body).connect(flutter).connect(env), 0.15);
  // A low rumble under it.
  const rumble = ctx.createBiquadFilter();
  rumble.type = 'lowpass';
  rumble.frequency.value = 180;
  const renv = ctx.createGain();
  renv.gain.setValueAtTime(0.0001, t);
  renv.gain.exponentialRampToValueAtTime(0.4 * volume, t + 0.08);
  renv.gain.setValueAtTime(0.4 * volume, end - 0.3);
  renv.gain.exponentialRampToValueAtTime(0.0001, end + 0.1);
  out(audio, noise(audio, t, secs + 0.15, 0.4).connect(rumble).connect(renv));
  // Blow-off valve as it ends: a short falling hiss.
  const hp = ctx.createBiquadFilter();
  hp.type = 'bandpass';
  hp.Q.value = 0.8;
  hp.frequency.setValueAtTime(5200, end);
  hp.frequency.exponentialRampToValueAtTime(1600, end + 0.4);
  out(audio, noise(audio, end, 0.45, 1.2).connect(hp).connect(decayGain(ctx, 0.22 * volume, end, 0.42, 0.01)), 0.2);
}

// ------------------------------------------------------------ jumps, misc

/** Taking off from a ramp: air rushing past. */
export function playWhoosh(audio: AudioSystem, volume: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 0.7;
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(1600, t + 0.35);
  bp.frequency.exponentialRampToValueAtTime(500, t + 0.8);
  out(audio, noise(audio, t, 0.9, 0.9).connect(bp).connect(decayGain(ctx, 0.28 * volume, t, 0.85, 0.15)));
}

/** Coming down: a heavy suspension thud (plus the crash sound if hard). */
export function playLanding(audio: AudioSystem, impact: number, pan: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = Math.min(1, impact / 12);
  const p = panner(ctx, pan);
  out(audio, p, 0.2);
  tone(ctx, 'sine', 90, 35, t, 0.25).connect(decayGain(ctx, 0.5 * s + 0.15, t, 0.25)).connect(p);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  noise(audio, t, 0.15, 0.5).connect(lp).connect(decayGain(ctx, 0.3 * s, t, 0.12)).connect(p);
  if (impact > 7) playImpact(audio, impact * 0.7, pan, 0.4);
}

/** A splash (landing in water). */
export function playSplash(audio: AudioSystem, volume: number): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 900;
  out(audio, noise(audio, t, 0.6, 1).connect(hp).connect(decayGain(ctx, 0.35 * volume, t, 0.55, 0.01)), 0.3);
}

/** Put back on the track: a quick sci-fi zap. */
export function playZap(audio: AudioSystem): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  out(audio, tone(ctx, 'square', 200, 1600, t, 0.18).connect(decayGain(ctx, 0.06, t, 0.2, 0.01)), 0.2);
}

// ------------------------------------------------------------------ crowd

/** Crowd ambience near the grandstand, and cheers. */
export class Crowd {
  private readonly gain: GainNode;
  private readonly audio: AudioSystem;

  constructor(audio: AudioSystem) {
    const ctx = audio.ctx!;
    this.audio = audio;
    const src = ctx.createBufferSource();
    src.buffer = audio.noiseBuffer();
    src.loop = true;
    src.playbackRate.value = 0.35;
    src.start();
    // Murmur: band-limited noise with a slow swell.
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.6;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.23;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.3;
    const am = ctx.createGain();
    am.gain.value = 0.7;
    swell.connect(swellDepth).connect(am.gain);
    swell.start();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    src.connect(bp).connect(am).connect(this.gain);
    out(audio, this.gain, 0.4);
  }

  /** closeness 0..1 to the grandstand. */
  update(closeness: number, now: number): void {
    this.gain.gain.setTargetAtTime(closeness * 0.12, now, 0.3);
  }

  /** A roar of cheering (finish, start, a lap). */
  cheer(volume: number, length = 2.2): void {
    const ctx = running(this.audio);
    if (!ctx) return;
    const t = ctx.currentTime;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * volume, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    out(this.audio, noise(this.audio, t, length, 0.45).connect(bp).connect(g), 0.5);
    // Whistles in the crowd.
    for (let i = 0; i < 3; i++) {
      const tw = t + 0.2 + R() * length * 0.5;
      const f = 1800 + R() * 900;
      out(this.audio, tone(ctx, 'sine', f, f * (R() < 0.5 ? 1.25 : 0.8), tw, 0.35).connect(decayGain(ctx, 0.03 * volume, tw, 0.35, 0.05)), 0.4);
    }
  }
}

// --------------------------------------------------------- beeps and blips

/** A short synth tone (beeps, chimes). */
export function playTone(
  audio: AudioSystem, freq: number, duration: number, type: OscillatorType = 'square', volume = 0.15, slideTo = 0, delay = 0,
): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo > 0) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(volume, t);
  g.gain.setValueAtTime(volume, t + duration * 0.7);
  g.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(g);
  out(audio, g, 0.15);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

/** Start lights: a beep per light; `go` is the long high one. */
export function playStartBeep(audio: AudioSystem, go: boolean): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const f = go ? 880 : 440;
  const len = go ? 0.7 : 0.16;
  for (const [type, v, det] of [['square', 0.08, 0], ['sine', 0.12, 2]] as const) {
    const o = tone(ctx, type, f * (1 + det / 1000), f * (1 + det / 1000), t, len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t);
    g.gain.setValueAtTime(v, t + len * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    out(audio, o.connect(g), 0.35);
  }
}

/** Menu sounds. */
export function playUi(audio: AudioSystem, kind: 'move' | 'change' | 'select' | 'deny' | 'buy'): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  const blip = (f0: number, f1: number, at: number, len: number, v: number, type: OscillatorType = 'square') =>
    out(audio, tone(ctx, type, f0, f1, t + at, len).connect(decayGain(ctx, v, t + at, len, 0.002)), 0.1);
  if (kind === 'move') blip(880, 880, 0, 0.035, 0.04);
  else if (kind === 'change') blip(660, 990, 0, 0.05, 0.05);
  else if (kind === 'select') {
    blip(660, 660, 0, 0.06, 0.06);
    blip(990, 990, 0.06, 0.09, 0.06);
  } else if (kind === 'deny') blip(180, 120, 0, 0.18, 0.08, 'sawtooth');
  else {
    blip(1046, 1046, 0, 0.07, 0.06);
    blip(1318, 1318, 0.07, 0.07, 0.06);
    blip(1568, 1568, 0.14, 0.14, 0.06);
  }
}

/** Pit repair: an impact wrench rattle and a little bell. */
export function playRepair(audio: AudioSystem): void {
  const ctx = running(audio);
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 7; i++) {
    out(audio, tone(ctx, 'sawtooth', 240, 150, t + i * 0.034, 0.026).connect(decayGain(ctx, 0.05, t + i * 0.034, 0.026, 0.001)), 0.05);
  }
  out(audio, tone(ctx, 'sine', 1568, 1568, t + 0.26, 0.3).connect(decayGain(ctx, 0.07, t + 0.26, 0.3, 0.002)), 0.2);
}

/** Rising arpeggio for crossing the finish line. */
export function playFanfare(audio: AudioSystem, good: boolean): void {
  const notes = good ? [523, 659, 784, 1047, 784, 1047] : [392, 494, 587, 523];
  notes.forEach((f, i) => playTone(audio, f, 0.16, 'square', 0.12, 0, i * 0.12));
}
