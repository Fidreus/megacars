// Achievements: what the player has unlocked and how far along each one is
// (saved in the browser). The rules live in achievementRules.ts; this feeds
// them and keeps score. Debug tools never feed it (see App.achSpoiled).

import { ACHIEVEMENTS, type AchInput, type AchievementRule, type Meter } from './achievementRules.ts';

const KEY = 'megacars.achievements.v1';

export interface AchState {
  /** Unlock time (ms since 1970) by achievement id. */
  unlocked: Record<string, number>;
  /** Count so far, for achievements with a goal above 1. */
  progress: Record<string, number>;
  /** Distinct keys seen, for "each of these" achievements. */
  keys: Record<string, string[]>;
}

export function emptyAchState(): AchState {
  return { unlocked: {}, progress: {}, keys: {} };
}

export function loadAchState(): AchState {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<AchState>) : {};
    return { unlocked: { ...v.unlocked }, progress: { ...v.progress }, keys: { ...v.keys } };
  } catch {
    return emptyAchState();
  }
}

export class Achievements {
  readonly state: AchState;
  readonly rules: readonly AchievementRule[];
  /** Called for each achievement as it unlocks. */
  onUnlock: (rule: AchievementRule) => void = () => {};
  private readonly meters = new Map<string, Meter>();
  private readonly scratch = new Map<string, Record<string, number>>();
  private readonly persist: boolean;
  private dirty = false;

  constructor(rules: readonly AchievementRule[] = ACHIEVEMENTS, state: AchState = loadAchState(), persist = true) {
    this.rules = rules;
    this.state = state;
    this.persist = persist;
    for (const r of rules) this.meters.set(r.id, this.makeMeter(r));
  }

  private makeMeter(rule: AchievementRule): Meter {
    const st = this.state;
    const goal = rule.goal ?? 1;
    const scratch: Record<string, number> = {};
    this.scratch.set(rule.id, scratch);
    const write = (n: number) => {
      const v = Math.max(0, Math.min(goal, Math.floor(n)));
      if (v !== (st.progress[rule.id] ?? 0)) {
        st.progress[rule.id] = v;
        this.dirty = true;
      }
    };
    return {
      get: () => st.progress[rule.id] ?? 0,
      set: write,
      max: (n) => write(Math.max(n, st.progress[rule.id] ?? 0)),
      add: (n = 1) => write((st.progress[rule.id] ?? 0) + n),
      addKey: (key) => {
        const list = (st.keys[rule.id] ??= []);
        if (!list.includes(key)) {
          list.push(key);
          write(list.length);
        }
      },
      scratch,
    };
  }

  isUnlocked(id: string): boolean {
    return id in this.state.unlocked;
  }

  /** Progress of an achievement (the goal once unlocked). */
  progress(rule: AchievementRule): number {
    return this.isUnlocked(rule.id) ? (rule.goal ?? 1) : (this.state.progress[rule.id] ?? 0);
  }

  get total(): { done: number; all: number } {
    return { done: this.rules.filter((r) => this.isUnlocked(r.id)).length, all: this.rules.length };
  }

  /** A new race: notes kept for one race are forgotten. */
  startRace(): void {
    for (const s of this.scratch.values()) for (const k in s) delete s[k];
    this.feed({ kind: 'raceStart' });
  }

  /** Give every rule an input; returns the achievements it unlocked. */
  feed(input: AchInput): AchievementRule[] {
    let out: AchievementRule[] | null = null;
    for (const rule of this.rules) {
      if (this.isUnlocked(rule.id)) continue;
      const meter = this.meters.get(rule.id)!;
      rule.feed(meter, input);
      if (meter.get() >= (rule.goal ?? 1)) {
        this.state.unlocked[rule.id] = Date.now();
        this.dirty = true;
        (out ??= []).push(rule);
      }
    }
    if (out) for (const r of out) this.onUnlock(r);
    // Ticks come sixty a second: save with the next real input instead.
    if (this.dirty && input.kind !== 'tick') this.save();
    return out ?? [];
  }

  private save(): void {
    this.dirty = false;
    if (!this.persist) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Not remembered.
    }
  }
}
