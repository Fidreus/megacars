import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { boardKey, leagueOf, leagueTuning } from './leagues.ts';
import { createRaceWorld } from './raceSetup.ts';
import { specProblem } from './records.ts';
import type { RaceSpec } from '../net/protocol.ts';

const spec = (league?: RaceSpec['league']): RaceSpec => ({
  id: 1, track: 'greenvalley', laps: 1, seed: 3, countdownTicks: 0, weapons: false, league,
  entrants: [{ name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 }, { name: 'AI', color: '#0f0', playerId: -1, skill: 0.9 }],
});

describe('leagues', () => {
  it('standard is the game as tuned; Supercars are faster and grip harder', () => {
    expect(leagueTuning(DEFAULT_TUNING, 'standard')).toBe(DEFAULT_TUNING);
    const sup = leagueTuning(DEFAULT_TUNING, 'super');
    expect(sup.vTop).toBeGreaterThan(DEFAULT_TUNING.vTop * 1.2);
    expect(sup.accel0).toBeGreaterThan(DEFAULT_TUNING.accel0);
    expect(sup.aGrip).toBeGreaterThan(DEFAULT_TUNING.aGrip);
    expect(DEFAULT_TUNING.vTop).toBe(45);
  });

  it('a race spec carries its league to every car', () => {
    expect(createRaceWorld(spec()).tunings[0].vTop).toBe(DEFAULT_TUNING.vTop);
    expect(createRaceWorld(spec('super')).tunings.every((t) => t.vTop > DEFAULT_TUNING.vTop)).toBe(true);
  });

  it('keeps records apart per league and rejects unknown leagues', () => {
    expect(boardKey('greenvalley', 'standard')).toBe('greenvalley');
    expect(boardKey('greenvalley', undefined)).toBe('greenvalley');
    expect(boardKey('greenvalley', 'super')).toBe('greenvalley@super');
    expect(specProblem(spec('super'))).toBeNull();
    expect(specProblem({ ...spec(), league: 'rocket' as never })).toBe('bad league');
    expect(leagueOf('nonsense')).toBe('standard');
  });
});
