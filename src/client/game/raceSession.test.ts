import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../../shared/config/tuning.ts';
import { paintById, setActivePaint } from './paints.ts';
import { attractSession, RaceSession } from './raceSession.ts';
import { DEFAULT_SETTINGS } from './settings.ts';

afterEach(() => setActivePaint(paintById('stock')));

describe('paint jobs in a race', () => {
  const settings = { ...DEFAULT_SETTINGS, opponents: 5, players: 1 as const };

  it('the stock paint leaves the grid as the spec has it', () => {
    const s = new RaceSession(settings, DEFAULT_TUNING, 1);
    expect(s.colors).toEqual(s.spec.entrants.map((e) => e.color));
    expect(s.looks.every((l) => l === undefined)).toBe(true);
  });

  it('paints the player car and keeps the spec (and so record checks) as it was', () => {
    setActivePaint(paintById('bubblegum'));
    const s = new RaceSession(settings, DEFAULT_TUNING, 1);
    const me = s.playerCars[0];
    expect(s.colors[me]).toBe('#ff6fb5');
    expect(s.looks[me]?.pattern).toBe('halves');
    expect(s.spec.entrants[me].color).not.toBe('#ff6fb5');
    expect(s.looks.filter(Boolean).length).toBe(1);
  });

  it('paints player 1 only in split screen', () => {
    setActivePaint(paintById('hazard'));
    const s = new RaceSession({ ...settings, players: 2, opponents: 4 }, DEFAULT_TUNING, 1);
    expect(s.playerCars.length).toBe(2);
    expect(s.looks[s.playerCars[0]]).toBeDefined();
    expect(s.looks[s.playerCars[1]]).toBeUndefined();
  });

  it('keeps the title screen demo in slot colours', () => {
    setActivePaint(paintById('hazard'));
    const s = attractSession(settings, DEFAULT_TUNING);
    expect(s.looks.every((l) => l === undefined)).toBe(true);
  });
});
