// window.__megacars: hooks for automated testing and debugging from the
// browser console (state inspection, scripted driving, tuning).

import type { CarTuning } from '../../shared/config/tuning.ts';
import { neutralInput } from '../../shared/sim/input.ts';
import type { App } from '../app.ts';
import { moodById } from '../render/mood.ts';
import type { PaletteModeId } from '../render/palette.ts';

export function installDebugApi(app: App): void {
  const api = {
    state() {
      const r = app.renderer;
      return {
        mode: app.mode,
        paused: app.paused,
        phase: app.world.race.phase,
        laps: app.world.race.laps,
        finishOrder: [...app.world.race.finishOrder],
        players: [...app.session.playerCars],
        tick: app.world.tick,
        fps: Math.round(app.fps),
        lowRes: [r.lowW, r.lowH],
        scale: r.scale,
        cars: app.world.cars.map((c) => ({
          id: c.id,
          x: +c.x.toFixed(2),
          z: +c.z.toFixed(2),
          speed: +Math.hypot(c.vx, c.vz).toFixed(2),
          y: +c.y.toFixed(2),
          heading: +c.heading.toFixed(3),
          slipDeg: +((c.slip * 180) / Math.PI).toFixed(1),
          sliding: c.sliding,
          lap: c.lap,
          place: c.place,
          finished: c.finished,
          respawns: c.respawns,
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
    debug: {
      /** Share of identical static pixels after moving the camera k pixels (1 = no crawl). */
      crawlTest: (k = 8) => app.crawlTest(k),
      /** Average ms per simulated + rendered frame. */
      bench: (frames = 120) => app.bench(frames),
      split: () => app.toggleSplit(),
      /** Change the look: mood id, palette mode (0 full, 1 12-bit, 2 32 colours), CRT level, outlines. */
      look(o: { mood?: string; palette?: number; crt?: number; outlines?: boolean }) {
        if (o.mood) app.setMood(moodById(o.mood));
        if (o.palette !== undefined) app.renderer.paletteMode = o.palette as PaletteModeId;
        if (o.crt !== undefined) app.renderer.crt = o.crt;
        if (o.outlines !== undefined) app.renderer.outlines = o.outlines;
      },
      /** Render a frame and save it as screenshots/<name>.png (dev server only). */
      async snap(name = 'shot'): Promise<string> {
        app.advance(0);
        const blob = await new Promise<Blob | null>((ok) => app.renderer.canvas.toBlob(ok, 'image/png'));
        if (!blob) return 'no image';
        const res = await fetch(`/dev/snap?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
        return res.ok ? res.text() : `failed: ${res.status}`;
      },
    },
    /** Freeze or resume the simulation (rendering continues). */
    pause(on = true) {
      app.paused = on;
    },
    /** Let the AI drive the player car (demo / testing). */
    autopilot(on = true) {
      app.player.aiDriven = on ? 1 : 0;
    },
    reset() {
      app.resetCar(app.session.playerCars[0]);
    },
    /** Music: what is playing and how loud it is right now. */
    playSong(key: string) {
      app.music.playSong(key);
    },
    music() {
      return { playing: app.music.nowPlaying, mode: app.music.mode, level: +app.music.level().toFixed(4), own: app.music.own.size };
    },
    /** Level of the sound effects (engines, tyres, bangs) right now. */
    sfx() {
      return +app.audio.level().toFixed(4);
    },
    /** Peak sample of the whole mix before the limiter (over 1 = would clip). */
    peak() {
      return +app.audio.peak().toFixed(3);
    },
    /** Online status: screen, room, connection and prediction health. */
    online() {
      const o = app.online;
      const n = app.netRace?.net;
      return {
        mode: app.mode,
        conn: o.state,
        me: o.me,
        rtt: Math.round(o.conn.rtt),
        room: o.room,
        race: n ? { tick: n.world.tick, server: n.predictor.serverTick, lead: n.predictor.lead, rate: n.rate, cars: n.localCars } : null,
      };
    },
    /** Start a race straight away, e.g. startRace({ players: 2, laps: 1 }). */
    startRace(over: Record<string, unknown> = {}) {
      app.startRace({ ...app.settings, ...over });
    },
    toTitle() {
      app.toTitle();
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
