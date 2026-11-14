import { describe, expect, it } from 'vitest';
import { defaultControls } from '../../input/bindings.ts';
import { highlightFor, hintFor, makeLabels, promptFor } from './prompts.ts';

const ids = ['basics', 'drift', 'lift', 'boost', 'lap'];
const phases = ['go', 'gas', 'brake', 'corner', 'hairpin', 'left', 'straight', 'approach', 'holding', 'late', 'done', 'charge', 'release', 'lap'];

describe('the school prompts', () => {
  it('name the keys as they are bound', () => {
    const c = defaultControls();
    expect(promptFor('drift', 'approach', makeLabels('keys', c))[0]).toContain('Z/B');
    c.solo.drift = ['KeyV'];
    expect(promptFor('drift', 'approach', makeLabels('keys', c))[0]).toContain('HOLD V ');
    c.solo.gas = ['KeyI'];
    expect(promptFor('basics', 'gas', makeLabels('keys', c))[0]).toContain('HOLD I ');
  });

  it('name the pad buttons on a gamepad', () => {
    const c = defaultControls();
    expect(promptFor('drift', 'approach', makeLabels('pad', c))[0]).toContain('HOLD LB ');
    expect(promptFor('basics', 'corner', makeLabels('pad', c))[0]).toContain('STICK');
    c.pad.drift = [5];
    expect(promptFor('boost', 'charge', makeLabels('pad', c), 0)[0]).toContain('HOLDING RB');
  });

  it('point at the on-screen buttons on a phone', () => {
    const c = defaultControls();
    const touch = makeLabels('touch', c, { gasMode: 'always', steerMode: 'point' });
    expect(promptFor('drift', 'approach', touch)[0]).toContain('THE DRIFT BUTTON');
    expect(promptFor('lift', 'approach', touch).join(' ')).toContain('THE BRAKE BUTTON');
    expect(highlightFor('drift', 'approach')).toEqual(['drift']);
    expect(highlightFor('lift', 'approach')).toEqual(['brake']);
    expect(highlightFor('drift', 'late')).toEqual([]);
  });

  it('fit the gas of the touch mode in the first lesson', () => {
    const c = defaultControls();
    const gas = (m: 'thumb' | 'always' | 'button') => promptFor('basics', 'gas', makeLabels('touch', c, { gasMode: m, steerMode: 'point' }))[0];
    expect(gas('always')).toContain('BY ITSELF');
    expect(gas('thumb')).toContain('THUMB');
    expect(gas('button')).toContain('GAS BUTTON');
  });

  it('say something for every lesson and phase, on every device, in capitals', () => {
    const c = defaultControls();
    for (const device of ['keys', 'pad', 'touch'] as const) {
      const L = makeLabels(device, c);
      for (const id of ids) {
        for (const ph of phases) {
          for (const stage of [0, 1]) {
            const lines = promptFor(id, ph, L, stage);
            expect(lines[0].length, `${device} ${id} ${ph}`).toBeGreaterThan(3);
            for (const l of lines) expect(l).toBe(l.toUpperCase());
          }
        }
      }
    }
  });

  it('keep the main line short enough for a phone', () => {
    const L = makeLabels('keys', defaultControls());
    for (const id of ids) for (const ph of phases) expect(promptFor(id, ph, L, 0)[0].length).toBeLessThanOrEqual(54);
  });

  it('have a hint for every failure the judges can give', () => {
    const L = makeLabels('keys', defaultControls());
    for (const code of ['wall', 'slow', 'idle', 'nobutton', 'nosteer', 'early', 'died', 'usedButton', 'nodrift', 'spin', 'boosts', 'time', 'both']) {
      expect(hintFor('drift', code, L).length, code).toBeGreaterThan(5);
    }
    expect(hintFor('drift', 'unknown', L)).toContain(' ');
  });
});
