// window.__megacars: hooks for automated testing and debugging from the
// browser console (state inspection, scripted driving, tuning).

import type { CarTuning } from '../../shared/config/tuning.ts';
import { neutralInput } from '../../shared/sim/input.ts';
import type { App } from '../app.ts';

export function installDebugApi(app: App): void {
  const api = {
    state() {
      const r = app.renderer;
      return {
        tick: app.world.tick,
        fps: Math.round(app.fps),
        lowRes: [r.lowW, r.lowH],
        scale: r.scale,
        cars: app.world.cars.map((c) => ({
          id: c.id,
          x: +c.x.toFixed(2),
          z: +c.z.toFixed(2),
          speed: +Math.hypot(c.vx, c.vz).toFixed(2),
          heading: +c.heading.toFixed(3),
          slipDeg: +((c.slip * 180) / Math.PI).toFixed(1),
          sliding: c.sliding,
          lap: c.lap,
          trackS: +c.trackS.toFixed(1),
          raceDist: +c.raceDist.toFixed(1),
          ai: c.aiDriven,
        })),
      };
    },
    /** Hold an input on the player car for `ticks` simulation ticks. */
    drive(input: { steer?: number; throttle?: number; brake?: number }, ticks = 60) {
      const i = neutralInput();
      Object.assign(i, input);
      app.input.override = i;
      app.input.overrideTicks = ticks;
    },
    /** Simulate `ticks` steps synchronously and render (works in hidden tabs). */
    advance(ticks = 60) {
      app.advance(ticks);
      return api.state();
    },
    /** Let the AI drive the player car (demo / testing). */
    autopilot(on = true) {
      app.player.aiDriven = on ? 1 : 0;
    },
    reset() {
      app.resetPlayer();
    },
    tuning(): CarTuning {
      return app.tuning;
    },
    setTuning(values: Partial<CarTuning>) {
      Object.assign(app.tuning, values);
    },
  };
  (window as unknown as { __megacars: typeof api }).__megacars = api;
}
