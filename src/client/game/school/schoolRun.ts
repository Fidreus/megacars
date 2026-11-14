// A driving school session: which lesson and stage the player is in, what the
// judge has made of the attempt so far, and what to show. The app calls
// `tick()` after every simulation step and `draw()` with the race UI.

import type { CarState } from '../../../shared/sim/car.ts';
import { Ev, type EventBuffer } from '../../../shared/sim/events.ts';
import type { CarInput } from '../../../shared/sim/input.ts';
import { resetProgress } from '../../../shared/sim/race.ts';
import { respawnCar } from '../../../shared/sim/world.ts';
import type { World } from '../../../shared/sim/world.ts';
import type { Track } from '../../../shared/track/types.ts';
import { drawText, textWidth } from '../../ui/font.ts';
import { buildFrame } from './frames.ts';
import { emptyFrame, makeLessons, type Judge, type Lesson, type Outcome } from './lessons.ts';
import { highlightFor, hintFor, promptFor, type Labels } from './prompts.ts';

/** Height of the band across the top (UI pixels); the HUD and minimap sit below it. */
export const SCHOOL_BAR = 44;
/** How long a result stays up before the next attempt starts (ticks). */
const WIN_TICKS = 100;
const FAIL_TICKS = 84;
/** Failures in a row (in one stage) before a hint is offered. */
export const HINT_AFTER = 3;
/** After this many, the pause menu is pointed out as the way to skip. */
export const SKIP_AFTER = 5;

export interface SchoolHost {
  world: World;
  track: Track;
  carId: number;
  /** The buttons the player's car was driven with this tick. */
  input(): CarInput;
  labels(): Labels;
  /** The car was moved: the view must not smooth over the jump. */
  teleported(): void;
  /** A lesson was passed (now, when the attempt was won). */
  passed(index: number): void;
  /** The lesson is over and its result has been shown: offer what next. */
  over(): void;
  sound(kind: 'win' | 'fail'): void;
}

/** Put the car at `s` on the road, rolling at `speed`, as if it had never been anywhere else. */
export function placeCar(world: World, track: Track, car: CarState, s: number, speed: number): void {
  respawnCar(car, track, s);
  resetProgress(car, track);
  const i = car.trackIdx;
  car.vx = track.tx[i] * speed;
  car.vz = track.tz[i] * speed;
  car.damage = 0;
  car.lap = 0;
  car.nextCp = 0;
  car.lapStartTick = world.tick;
  car.driftArm = 0;
  car.spinCool = 0;
  car.ghostTicks = 0;
}

export class SchoolRun {
  readonly lessons: Lesson[];
  index = 0;
  stage = 0;
  /** Wins so far in this stage, and in the whole lesson. */
  wins = 0;
  totalWins = 0;
  private judge: Judge;
  private readonly frame = emptyFrame();
  private startTick = 0;
  private dist0 = 0;
  /** A result being shown (the next attempt starts when `ticks` runs out). */
  result: { ok: boolean; text: string; ticks: number; wait: number } | null = null;
  /** Failures in a row in this stage, and the last reason. */
  fails = 0;
  private lastCode = '';
  /** Set once the whole lesson is passed: no more attempts until the app moves on. */
  finished = false;
  /** Shown big for a moment when a lesson or the school is completed. */
  private readonly host: SchoolHost;
  /** The lesson was left by skipping. */
  skipped = false;

  constructor(host: SchoolHost, lesson = 0) {
    this.host = host;
    this.lessons = makeLessons(host.track.length);
    this.judge = this.lessons[0].stages[0].judge();
    this.begin(lesson);
  }

  get lesson(): Lesson {
    return this.lessons[this.index];
  }

  get goal(): number {
    return this.lesson.stages.reduce((n, s) => n + s.goal, 0);
  }

  /** Start (or restart) a lesson from its first stage. */
  begin(index: number): void {
    this.index = Math.max(0, Math.min(this.lessons.length - 1, index));
    this.stage = 0;
    this.wins = 0;
    this.totalWins = 0;
    this.fails = 0;
    this.lastCode = '';
    this.finished = false;
    this.skipped = false;
    this.result = null;
    this.attempt();
  }

  /** Put the car at the start of the stage and begin judging. */
  attempt(): void {
    const st = this.lesson.stages[this.stage];
    const h = this.host;
    const car = h.world.cars[h.carId];
    placeCar(h.world, h.track, car, st.s, st.speed);
    this.judge = st.judge();
    this.startTick = h.world.tick;
    this.dist0 = car.raceDist;
    this.result = null;
    h.teleported();
  }

  /** Called after every simulation tick. */
  tick(ev: EventBuffer): void {
    const h = this.host;
    const w = h.world;
    const car = w.cars[h.carId];
    if (this.finished && !this.result) return;
    if (this.result) {
      if (--this.result.wait > 0) return;
      this.result = null;
      if (this.finished) this.host.over();
      else this.attempt();
      return;
    }
    // RESET, a tow or the stuck rule moved the car: just start the attempt over.
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if (e.kind === Ev.Respawn && e.car === h.carId) {
        this.attempt();
        return;
      }
    }
    const f = buildFrame(this.frame, car, h.input(), ev, w.tick - this.startTick, this.dist0);
    const out = this.judge.step(f);
    if (out) this.decide(out);
  }

  private decide(out: Outcome): void {
    if (out.ok) {
      this.fails = 0;
      this.host.sound('win');
      this.wins++;
      this.totalWins++;
      const st = this.lesson.stages[this.stage];
      if (this.wins >= st.goal) {
        this.stage++;
        this.wins = 0;
      }
      if (this.stage >= this.lesson.stages.length) {
        this.finished = true;
        this.result = { ok: true, text: out.text, ticks: WIN_TICKS, wait: WIN_TICKS };
        this.host.passed(this.index);
        return;
      }
      this.result = { ok: true, text: out.text, ticks: WIN_TICKS, wait: WIN_TICKS };
      return;
    }
    this.fails++;
    this.lastCode = out.code;
    this.host.sound('fail');
    this.result = { ok: false, text: out.text, ticks: FAIL_TICKS, wait: FAIL_TICKS };
  }

  /** The lesson was given up on (the pause menu): the next one is offered. */
  skip(): void {
    this.skipped = true;
    this.finished = true;
  }

  get hint(): string {
    return this.fails >= HINT_AFTER ? hintFor(this.lesson.id, this.lastCode, this.host.labels()) : '';
  }

  /** What to show above the car now. */
  get phase(): string {
    return this.judge.phase();
  }

  /** Touch buttons to light up. */
  highlight(): string[] {
    return this.result || this.finished ? [] : highlightFor(this.lesson.id, this.phase);
  }

  /** The prompt lines for now (keys as bound). */
  prompt(): string[] {
    return promptFor(this.lesson.id, this.phase, this.host.labels(), this.stage);
  }

  /** For tests and the debug API. */
  debug() {
    return {
      lesson: this.lesson.id,
      index: this.index,
      stage: this.stage,
      wins: this.wins,
      totalWins: this.totalWins,
      goal: this.goal,
      phase: this.phase,
      fails: this.fails,
      result: this.result ? { ok: this.result.ok, text: this.result.text } : null,
      finished: this.finished,
      hint: this.hint,
    };
  }

  // -------------------------------------------------------------- drawing

  /** The prompt, progress and result, drawn in a band across the top. */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const side = 8;
    // The right end is left to the pause button and the minimap's corner.
    const maxW = W - side - 44;
    ctx.fillStyle = 'rgba(8,10,24,0.62)';
    ctx.fillRect(0, 0, W, SCHOOL_BAR);
    ctx.fillStyle = 'rgba(255,216,74,0.9)';
    ctx.fillRect(0, SCHOOL_BAR - 1, W, 1);
    const head = `LESSON ${this.index + 1} OF ${this.lessons.length}  ${this.lesson.name}`;
    drawText(ctx, head, side, 4, { color: '#ffd84a' });
    if (this.goal > 1) drawText(ctx, `${Math.min(this.totalWins, this.goal)} OF ${this.goal}`, W - 44, 4, { color: '#9cff9c', align: 'right' });
    const cx = Math.round((side + W - 44) / 2);
    const r = this.result;
    const hint = this.hint;
    if (r) {
      const scale = textWidth(r.text, 2) <= maxW ? 2 : 1;
      drawText(ctx, r.text, cx, 16, { scale, color: r.ok ? '#9cff9c' : '#ff6b5e', align: 'center' });
      if (!r.ok && hint) this.line2(ctx, cx, `HINT: ${hint}`, '#ffd84a', maxW);
      else if (!r.ok && this.fails >= SKIP_AFTER) this.line2(ctx, cx, this.skipHint(), '#c8d0dc', maxW);
      return;
    }
    const lines = this.prompt();
    const main = lines[0] ?? '';
    const scale = textWidth(main, 2) <= maxW ? 2 : 1;
    drawText(ctx, main, cx, scale === 2 ? 16 : 18, { scale, color: '#ffffff', align: 'center' });
    if (hint) this.line2(ctx, cx, `HINT: ${hint}`, '#ffd84a', maxW);
    else if (lines[1]) this.line2(ctx, cx, lines[1], '#c8d0dc', maxW);
    const m = this.judge.meter();
    if (m) this.drawMeter(ctx, W, H, m.label, m.value, m.mark);
    const note = this.judge.note();
    if (note) drawText(ctx, note, W / 2, H - 14, { color: '#c8d0dc', align: 'center' });
  }

  /** How to leave a lesson that is not working out, in the player's words. */
  private skipHint(): string {
    return this.host.labels().touch ? 'TAP II TO SKIP THIS LESSON' : 'ESC: PAUSE MENU - SKIP THIS LESSON';
  }

  private line2(ctx: CanvasRenderingContext2D, cx: number, text: string, color: string, maxW: number): void {
    // A line that is too long for the band loses its tail rather than running under the buttons.
    let t = text;
    while (t.length > 8 && textWidth(t) > maxW) t = t.slice(0, -4);
    if (t !== text) t = `${t.trim()}...`;
    drawText(ctx, t, cx, 33, { color, align: 'center' });
  }

  private drawMeter(ctx: CanvasRenderingContext2D, W: number, H: number, label: string, value: number, mark?: number): void {
    const w = Math.min(120, Math.round(W * 0.3));
    const x = Math.round(W / 2 - w / 2);
    const y = H - 30;
    ctx.fillStyle = 'rgba(8,10,24,0.72)';
    ctx.fillRect(x - 26, y - 4, w + 32, 14);
    drawText(ctx, label, x - 22, y, { color: '#c8d0dc' });
    ctx.fillStyle = '#222';
    ctx.fillRect(x + 20, y, w - 20, 6);
    ctx.fillStyle = value >= 1 ? '#9cff9c' : '#ffd84a';
    ctx.fillRect(x + 20, y, Math.round((w - 20) * Math.min(1, value)), 6);
    if (mark !== undefined) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(x + 20 + Math.round((w - 20) * mark) - 1, y - 2, 1, 10);
    }
  }
}
