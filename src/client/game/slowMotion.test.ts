import { describe, expect, it } from 'vitest';
import { BEAT_SECONDS, COOLDOWN, SLOWEST, SlowMotion } from './slowMotion.ts';

function run(s: SlowMotion, seconds: number, dt = 1 / 60): number {
  // Returns the simulated seconds that a game fed `timeScale` would get.
  let sim = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    sim += dt * s.timeScale;
    s.update(dt);
  }
  return sim;
}

describe('slow motion', () => {
  it('slows to about a third and then ends by itself', () => {
    const s = new SlowMotion();
    expect(s.trigger(0, true)).toBe(true);
    let min = 1;
    for (let t = 0; t < BEAT_SECONDS + 0.1; t += 1 / 60) {
      min = Math.min(min, s.timeScale);
      s.update(1 / 60);
    }
    expect(min).toBeLessThan(SLOWEST + 0.05);
    expect(min).toBeGreaterThanOrEqual(SLOWEST - 1e-9);
    expect(s.timeScale).toBe(1);
    expect(s.depth).toBe(0);
  });

  it('keeps most of the beat short: it costs well under a second of game time', () => {
    const s = new SlowMotion();
    s.trigger(0, true);
    const sim = run(s, BEAT_SECONDS);
    expect(sim).toBeGreaterThan(0.3);
    expect(sim).toBeLessThan(0.65);
  });

  it('does not come back for a few seconds', () => {
    const s = new SlowMotion();
    expect(s.trigger(0, true)).toBe(true);
    run(s, BEAT_SECONDS + 0.1);
    expect(s.trigger(0, true)).toBe(false);
    run(s, COOLDOWN);
    expect(s.trigger(0, true)).toBe(true);
  });

  it('is off when switched off', () => {
    const s = new SlowMotion();
    s.enabled = false;
    expect(s.trigger(0, true)).toBe(false);
    expect(s.timeScale).toBe(1);
  });

  it('online and in split screen only the camera moves', () => {
    const s = new SlowMotion();
    s.trigger(1, false);
    run(s, 0.2);
    expect(s.timeScale).toBe(1);
    expect(s.pitch).toBe(1);
    expect(s.push(1, true)).toBeGreaterThan(0);
    expect(s.push(0, true)).toBe(0);
    expect(s.push(0, false)).toBeGreaterThan(0);
  });
});
