import { describe, expect, it } from 'vitest';
import { DRIFT_BOOST } from '../../../shared/sim/driftBoost.ts';
import { boostJudge, cornerJudge, emptyFrame, HZ, lapJudge, LAP_BOOSTS, LAP_TARGET_S, makeLessons, WALL_CRASH, type Frame, type Judge, type Outcome } from './lessons.ts';

/** Feed a judge frames made by `make(tick)` until it decides (or `max` ticks). */
function run(j: Judge, make: (t: number) => Partial<Frame>, max = 40 * HZ): Outcome | null {
  for (let t = 0; t < max; t++) {
    const out = j.step({ ...emptyFrame(), tick: t, ...make(t) });
    if (out) return out;
  }
  return null;
}

/** A car rolling along at 30 m/s from `s0`. */
const rolling = (s0: number) => (t: number): Partial<Frame> => ({ s: s0 + (t * 30) / HZ, dist: (t * 30) / HZ, speed: 30 });

describe('the drift button lesson', () => {
  const corner = (drift: (t: number) => Partial<Frame>) => (t: number) => ({ ...rolling(230)(t), ...drift(t) });
  const sliding = { sliding: true, slipDeg: 20, drift: true };

  it('is passed by a drift held for a second without a wall', () => {
    const out = run(cornerJudge('button'), corner((t) => (t > 90 && t < 90 + 80 ? sliding : {})));
    expect(out).toEqual({ ok: true, text: 'NICE DRIFT' });
  });

  it('fails a drift let go too early, and says so', () => {
    const out = run(cornerJudge('button'), corner((t) => (t > 90 && t < 90 + 30 ? sliding : {})));
    expect(out).toMatchObject({ ok: false, code: 'early', text: 'LET GO TOO EARLY' });
  });

  it('bridges a short gap in a drift but not a long one', () => {
    const gap = (n: number) => corner((t) => ((t > 90 && t < 130) || (t > 130 + n && t < 130 + n + 30) ? sliding : {}));
    expect(run(cornerJudge('button'), gap(4))).toMatchObject({ ok: true });
    expect(run(cornerJudge('button'), gap(20))).toMatchObject({ ok: false, code: 'early' });
  });

  it('only counts a slide with the drift button held', () => {
    const out = run(cornerJudge('button'), corner((t) => (t > 90 && t < 190 ? { sliding: true, slipDeg: 20 } : {})));
    expect(out).toMatchObject({ ok: false });
  });

  it('fails on a wall, and tells a missing press from a slow entry', () => {
    expect(run(cornerJudge('button'), corner((t) => (t === 100 ? { wall: WALL_CRASH + 1 } : {})))).toMatchObject({ ok: false, code: 'wall', text: 'HIT THE WALL' });
    expect(run(cornerJudge('button'), corner(() => ({})))).toMatchObject({ ok: false, code: 'nobutton' });
    expect(run(cornerJudge('button'), corner((t) => ({ speed: 10, drift: t > 90 })))).toMatchObject({ ok: false, code: 'slow', text: 'TOO SLOW INTO THE CORNER' });
    expect(run(cornerJudge('button'), corner((t) => ({ drift: t > 80 })))).toMatchObject({ ok: false, code: 'nosteer' });
  });

  it('forgives a light scrape of the wall', () => {
    const out = run(cornerJudge('button'), corner((t) => ({ ...(t > 90 && t < 180 ? sliding : {}), wall: t === 120 ? WALL_CRASH - 1 : 0 })));
    expect(out).toMatchObject({ ok: true });
  });

  it('gives up on a car that stands still', () => {
    expect(run(cornerJudge('button'), () => ({ s: 220, speed: 0 }), 30 * HZ)).toMatchObject({ ok: false, code: 'slow' });
  });
});

describe('the drift without the button lesson', () => {
  const corner = (drift: (t: number) => Partial<Frame>) => (t: number) => ({ ...rolling(230)(t), ...drift(t) });

  it('counts a slide that started without the button', () => {
    const out = run(cornerJudge('lift'), corner((t) => (t > 90 && t < 190 ? { sliding: true, slipDeg: 15 } : {})));
    expect(out).toMatchObject({ ok: true });
  });

  it('does not count a slide that started with the button', () => {
    const out = run(cornerJudge('lift'), corner((t) => (t > 90 && t < 190 ? { sliding: true, slipDeg: 15, drift: true } : {})));
    expect(out).toMatchObject({ ok: false, code: 'usedButton' });
  });

  it('says the drift died when it is too short, and when there was none', () => {
    expect(run(cornerJudge('lift'), corner((t) => (t > 90 && t < 110 ? { sliding: true, slipDeg: 15 } : {})))).toMatchObject({ ok: false, code: 'died' });
    expect(run(cornerJudge('lift'), corner(() => ({})))).toMatchObject({ ok: false, code: 'nodrift' });
  });

  it('ignores slides on the straight before the corner', () => {
    const out = run(cornerJudge('lift'), (t) => ({ s: 100 + t * 0.4, speed: 30, sliding: true, slipDeg: 20 }), 5 * HZ);
    expect(out).toBeNull();
  });
});

describe('the drift boost lesson', () => {
  const want2 = () => boostJudge(2, 283, 435);
  const lead = (t: number) => ({ ...rolling(215)(t) });

  it('is passed by a boost of the level asked for (or higher)', () => {
    expect(run(want2(), (t) => ({ ...lead(t), boost: t === 200 ? 2 : 0 }))).toEqual({ ok: true, text: 'LEVEL 2 BOOST' });
    expect(run(want2(), (t) => ({ ...lead(t), boost: t === 200 ? 3 : 0 }))).toMatchObject({ ok: true });
  });

  it('fails a level 1 boost as let go too early', () => {
    const out = run(want2(), (t) => ({ ...lead(t), levelUp: t === 100 ? 1 : 0, boost: t === 150 ? 1 : 0 }));
    expect(out).toMatchObject({ ok: false, code: 'early', text: 'LET GO TOO EARLY' });
  });

  it('tells a lost charge by a wall from a spin', () => {
    const wall = run(want2(), (t) => ({ ...lead(t), wall: t === 120 ? 6 : 0, lost: t === 120 ? 1 : 0 }));
    expect(wall).toMatchObject({ ok: false, code: 'wall' });
    const spin = run(want2(), (t) => ({ ...lead(t), lost: t === 120 ? 2 : 0 }));
    expect(spin).toMatchObject({ ok: false, code: 'spin', text: 'SPUN OUT - CHARGE LOST' });
  });

  it('says nothing was charged when there was no drift', () => {
    expect(run(want2(), lead)).toMatchObject({ ok: false, code: 'nodrift' });
  });

  it('shows the meter filling and tells when to let go', () => {
    const j = want2();
    j.step({ ...emptyFrame(), s: 330, sliding: true, charge: DRIFT_BOOST.levels[1] / 2, level: 1 });
    expect(j.meter()?.value).toBeCloseTo(0.5);
    expect(j.phase()).toBe('charge');
    j.step({ ...emptyFrame(), s: 340, sliding: true, charge: DRIFT_BOOST.levels[1], level: 2 });
    expect(j.phase()).toBe('release');
  });
});

describe('the lap lesson', () => {
  const lap = (boosts: number, seconds: number) => run(lapJudge(1500, LAP_BOOSTS, LAP_TARGET_S), (t) => ({
    tick: t, dist: (t / (seconds * HZ)) * 1500, boost: boosts > 0 && t % 300 === 0 && t / 300 <= boosts ? 1 : 0,
  }), 100 * HZ);

  it('needs the boosts and the time', () => {
    expect(lap(5, 50)).toMatchObject({ ok: true });
    expect(lap(1, 50)).toMatchObject({ ok: false, code: 'boosts' });
    expect(lap(5, 70)).toMatchObject({ ok: false, code: 'time' });
    expect(lap(0, 70)).toMatchObject({ ok: false, code: 'both' });
  });
});

describe('the lesson list', () => {
  const lessons = makeLessons(1500);

  it('has five lessons with a way to be won', () => {
    expect(lessons.map((l) => l.id)).toEqual(['basics', 'drift', 'lift', 'boost', 'lap']);
    for (const l of lessons) {
      expect(l.stages.length).toBeGreaterThan(0);
      for (const s of l.stages) expect(s.goal).toBeGreaterThan(0);
    }
  });

  it('asks for a few drifts in lessons 2 and 3', () => {
    expect(lessons[1].stages[0].goal).toBe(3);
    expect(lessons[2].stages[0].goal).toBe(3);
  });

  it('starts every stage on a fresh judge', () => {
    const st = lessons[1].stages[0];
    expect(st.judge()).not.toBe(st.judge());
  });
});
