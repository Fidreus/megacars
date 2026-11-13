// The slow-motion beat when a car is wrecked: for about 0.8 s of real time the
// game runs at a third of its speed and eases back, the camera pushes in a
// little and engines sound lower. Only the speed the client feeds its fixed
// step changes; the simulation itself never knows (every tick is still run
// and recorded exactly once, so lap records stay valid).
//
// Online the server owns the clock and in split screen two people share it,
// so there only the camera effect plays (`slowTime` false).

/** Real seconds the beat lasts. */
export const BEAT_SECONDS = 0.8;
/** Lowest speed, as a share of normal. */
export const SLOWEST = 0.33;
/** Real seconds that must pass between the starts of two beats. */
export const COOLDOWN = 4;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class SlowMotion {
  /** The SLOW MOTION option. */
  enabled = true;
  /** Real seconds into the beat, or -1 when none is running. */
  private t = -1;
  private cool = 0;
  private slowTime = false;
  private view = 0;

  /** Start a beat unless one ran lately. `view`: whose camera pushes in. */
  trigger(view: number, slowTime: boolean): boolean {
    if (!this.enabled || this.t >= 0 || this.cool > 0) return false;
    this.t = 0;
    this.cool = COOLDOWN;
    this.slowTime = slowTime;
    this.view = view;
    return true;
  }

  /** Advance by real seconds. */
  update(dt: number): void {
    this.cool = Math.max(0, this.cool - dt);
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= BEAT_SECONDS) this.t = -1;
  }

  reset(): void {
    this.t = -1;
    this.cool = 0;
  }

  /** 0..1: how deep into the beat we are (in quickly, out gently). */
  get depth(): number {
    if (this.t < 0) return 0;
    return smooth(0, 0.08, this.t) * (1 - smooth(0.4, BEAT_SECONDS, this.t));
  }

  /** Multiplier for the time fed to the simulation's accumulator. */
  get timeScale(): number {
    return this.slowTime ? 1 - (1 - SLOWEST) * this.depth : 1;
  }

  /** Camera push-in for a view, 0..1. */
  push(view: number, split: boolean): number {
    return !split || view === this.view ? this.depth : 0;
  }

  /** Engine pitch factor (1 = normal). */
  get pitch(): number {
    return this.slowTime ? 1 - 0.4 * this.depth : 1;
  }
}
