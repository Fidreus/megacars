// Vibration: short rumble pulses on gamepads and phones for the big moments.
// Gamepads use `vibrationActuator.playEffect('dual-rumble', ...)` where the
// browser and pad have it; phones use `navigator.vibrate` (Android only, iOS
// has none). Everything fails silently where it is not supported.
//
// To give a new kind of simulation event a rumble, add one line to RULES:
//   [Ev.Something]: { rumble: (e) => thump(scale(e.value, 2, 12)) },
// `felt` says who feels it: the car in `e.car` (default), both `car` and
// `other` ('both'), or every local player ('all').

import { Ev, type SimEvent } from '../../shared/sim/events.ts';

export interface Rumble {
  /** Low-frequency motor 0..1 (the heavy thump). */
  strong: number;
  /** High-frequency motor 0..1 (the buzz). */
  weak: number;
  /** Length in milliseconds (keep it short). */
  ms: number;
  /** Phone only: an on/off/on pattern instead of one pulse. */
  pattern?: number[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** 0 at `lo`, 1 at `hi`. */
export const scale = (v: number, lo: number, hi: number): number => clamp01((v - lo) / (hi - lo));

/** A knock that grows with `level` 0..1 (walls, cars). */
export const thump = (level: number): Rumble => ({ strong: 0.25 + 0.75 * level, weak: 0.1 + 0.4 * level, ms: Math.round(40 + 110 * level) });

/** A landing: softer and rounder than a crash. */
export const landing = (level: number): Rumble => ({ strong: 0.2 + 0.6 * level, weak: 0.3 + 0.3 * level, ms: Math.round(50 + 90 * level) });

/** Fixed pulses for things that are not simulation events. */
export const PULSE = {
  /** A start light coming on. */
  light: { strong: 0, weak: 0.3, ms: 40 } as Rumble,
  /** The lights go out. */
  go: { strong: 0.7, weak: 0.5, ms: 200 } as Rumble,
};

export interface Rule {
  rumble: (e: SimEvent) => Rumble | null;
  felt?: 'car' | 'both' | 'all';
}

export const RULES: Record<number, Rule> = {
  // Scrapes along a wall are too small to bother with.
  [Ev.WallHit]: { rumble: (e) => (e.value < 2.5 ? null : thump(scale(e.value, 2.5, 22))) },
  [Ev.CarHit]: { felt: 'both', rumble: (e) => (e.value < 2.5 ? null : thump(scale(e.value, 2.5, 18))) },
  // value 1: missile, 2: mine (a mine launches the car as well).
  [Ev.Explosion]: { rumble: (e) => (e.value === 2 ? { strong: 1, weak: 0.8, ms: 300 } : e.value === 1 ? { strong: 0.9, weak: 0.6, ms: 220 } : null) },
  [Ev.Wreck]: { rumble: () => ({ strong: 1, weak: 0.9, ms: 450, pattern: [90, 40, 180] }) },
  [Ev.Land]: { rumble: (e) => (e.value < 3 ? null : landing(scale(e.value, 3, 14))) },
  // value 1: a catch-up pad rather than a turbo from the stock.
  [Ev.Turbo]: { rumble: (e) => (e.value === 1 ? { strong: 0.2, weak: 0.4, ms: 120 } : { strong: 0.35, weak: 0.6, ms: 160 }) },
  [Ev.RaceStart]: { felt: 'all', rumble: () => PULSE.go },
};

/** Where the rumble goes: the browser side, replaceable in tests. */
export interface HapticsIo {
  /** Rumble gamepad `index`; true if it has a motor to play on. */
  pad(index: number, r: Rumble): boolean;
  vibrate(pattern: number | number[]): void;
  /** Stop everything. */
  stop(padIndexes: number[]): void;
}

export const browserIo: HapticsIo = {
  pad(index, r) {
    try {
      const gp = navigator.getGamepads?.()[index];
      const act = gp?.vibrationActuator as { playEffect?: (type: string, p: object) => Promise<unknown> } | undefined;
      if (!act?.playEffect) return false;
      void act.playEffect('dual-rumble', { startDelay: 0, duration: r.ms, weakMagnitude: r.weak, strongMagnitude: r.strong })?.catch?.(() => {});
      return true;
    } catch {
      return false;
    }
  },
  vibrate(pattern) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Not allowed (no tap yet) or not supported: no buzz.
    }
  },
  stop(padIndexes) {
    try {
      for (const i of padIndexes) {
        const act = navigator.getGamepads?.()[i]?.vibrationActuator as { reset?: () => Promise<unknown> } | undefined;
        void act?.reset?.()?.catch?.(() => {});
      }
      navigator.vibrate?.(0);
    } catch {
      // Nothing to stop.
    }
  },
};

/** What the game tells us about the local players. */
export interface HapticsWhere {
  /** Car ids of the local players (player 1 first). */
  players(): readonly number[];
  /** Gamepad index of a local player, or -1. */
  pad(player: number): number;
  /** The phone's on-screen controls are in use. */
  phone(): boolean;
}

export class Haptics {
  /** The VIBRATION option. */
  enabled = true;
  private readonly where: HapticsWhere;
  private readonly io: HapticsIo;
  /** Per player: when the last pulse ends and how strong it was. */
  private readonly busy = [{ until: 0, level: 0 }, { until: 0, level: 0 }];

  constructor(where: HapticsWhere, io: HapticsIo = browserIo) {
    this.where = where;
    this.io = io;
  }

  /** A simulation event: whoever's car it concerns feels it. */
  event(e: SimEvent): void {
    if (!this.enabled) return;
    const rule = RULES[e.kind];
    if (!rule) return;
    const players = this.where.players();
    for (let p = 0; p < players.length; p++) {
      const id = players[p];
      const felt = rule.felt === 'all' || id === e.car || (rule.felt === 'both' && id === e.other);
      if (!felt) continue;
      const r = rule.rumble(e);
      if (r) this.play(p, r);
    }
  }

  /** Every local player feels this (start lights). */
  all(r: Rumble): void {
    const n = this.where.players().length;
    for (let p = 0; p < n; p++) this.play(p, r);
  }

  /** One pulse for one local player (0 or 1). */
  play(p: number, r: Rumble, now = performance.now()): void {
    if (!this.enabled) return;
    const slot = this.busy[p];
    if (!slot) return;
    const level = Math.max(r.strong, r.weak);
    // A pulse still running is only cut off by a stronger one (this also
    // swallows the repeats when the predictor re-runs ticks online).
    if (now < slot.until && level <= slot.level) return;
    slot.until = now + r.ms;
    slot.level = level;
    this.io.pad(this.where.pad(p), r);
    // The phone only has one motor: player 1's.
    if (p === 0 && this.where.phone()) this.io.vibrate(r.pattern ?? Math.round(10 + 90 * level));
  }

  /** Stop at once (pause, leaving the race). */
  stop(): void {
    this.busy.forEach((b) => (b.until = 0));
    this.io.stop([this.where.pad(0), this.where.pad(1)].filter((i) => i >= 0));
  }
}
