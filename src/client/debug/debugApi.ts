// window.__megacars: hooks for automated testing and debugging from the
// browser console (state inspection, scripted driving, tuning).

import type * as THREE from 'three';
import type { CarTuning } from '../../shared/config/tuning.ts';
import { neutralInput, quantizeInput, type CarInput } from '../../shared/sim/input.ts';
import { createRaceWorld } from '../../shared/game/raceSetup.ts';
import { ReplayRecorder } from '../../shared/game/records.ts';
import { stepWorld } from '../../shared/sim/step.ts';
import { PROTOCOL_VERSION, type RaceSpec } from '../../shared/net/protocol.ts';
import { DEFAULT_TUNING } from '../../shared/config/tuning.ts';
import type { App } from '../app.ts';
import type { TimeTrial } from '../game/timeTrial.ts';
import type { LapTape } from '../../shared/game/ghost.ts';
import { loadWorldGhost, saveMyGhost } from '../game/ghostStore.ts';
import { fetchBoards } from '../game/records.ts';
import { boardKey, type League } from '../../shared/game/leagues.ts';
import { moodById } from '../render/mood.ts';
import { rainAt, wetnessAt } from '../../shared/sim/weather.ts';
import type { PaletteModeId } from '../render/palette.ts';

export function installDebugApi(app: App): void {
  const api = {
    state() {
      const r = app.renderer;
      return {
        mode: app.mode,
        track: app.session.track.def.id,
        paused: app.paused,
        phase: app.world.race.phase,
        laps: app.world.race.laps,
        finishOrder: [...app.world.race.finishOrder],
        players: [...app.session.playerCars],
        tick: app.world.tick,
        fps: Math.round(app.fps),
        lowRes: [r.lowW, r.lowH],
        scale: r.scale,
        /** Race weather: plan (ticks) and the wetness and rain now. */
        weather: app.world.weather ? { ...app.world.weather, wet: +wetnessAt(app.world.weather, app.world.tick).toFixed(3), rain: +rainAt(app.world.weather, app.world.tick).toFixed(3) } : null,
        cars: app.world.cars.map((c) => ({
          id: c.id,
          x: +c.x.toFixed(2),
          z: +c.z.toFixed(2),
          speed: +Math.hypot(c.vx, c.vz).toFixed(2),
          y: +c.y.toFixed(2),
          heading: +c.heading.toFixed(3),
          steer: +c.steer.toFixed(2),
          /** A point on the centreline a little ahead (for scripted test driving). */
          ahead: [+app.track.px[(c.trackIdx + 14) % app.track.n].toFixed(1), +app.track.pz[(c.trackIdx + 14) % app.track.n].toFixed(1)],
          slipDeg: +((c.slip * 180) / Math.PI).toFixed(1),
          sliding: c.sliding,
          lap: c.lap,
          place: c.place,
          finished: c.finished,
          respawns: c.respawns,
          trackS: +c.trackS.toFixed(1),
          raceDist: +c.raceDist.toFixed(1),
          ai: c.aiDriven,
          /** Elimination: order out (0 = still in) and the leader's lap it went out on. */
          out: c.outOrder,
          outLap: c.outLap,
        })),
        elim: app.world.elim ?? null,
      };
    },
    /** The track editor's state (null when it isn't open). */
    editor() {
      return app.trackEditor?.active ? app.trackEditor.debugState() : null;
    },
    /** Hold an input on the player car for `ticks` simulation ticks. */
    drive(input: { steer?: number; throttle?: number; brake?: number }, ticks = 60) {
      app.spoilAchievements();
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
      /** Put the first player's car at (x, z), standing still (for looking at a spot). */
      place(x: number, z: number) {
        app.spoilAchievements();
        const car = app.world.cars[app.session.playerCars[0]];
        if (!car) return;
        car.x = x;
        car.z = z;
        car.vx = car.vz = car.angVel = 0;
      },
      /** Item crates: where they stand and which are there (0) or coming back (ticks). */
      crates() {
        return app.session.track.crates.map((c, k) => ({ x: c.x, z: c.z, row: c.row, away: app.world.crates[k] ?? 0 }));
      },
      /** Zoom the camera out (k > 1) or in, for looking at the scenery. */
      zoom(k = 1) {
        app.debugZoom = k;
      },
      /** Point the camera at (x, z) instead of the car; no arguments to follow the car again. */
      aim(x?: number, z?: number) {
        app.debugLook = x === undefined || z === undefined ? null : { x, z };
      },
      /** Where the track life put its placed objects (camps, paddocks, pumps...), for looking at them. */
      lifeSpots() {
        const out: [number, number][] = [];
        app.scene.getObjectByName('trackLife')?.children.forEach((o) => {
          if (o.type === 'Group' && (o.position.x !== 0 || o.position.z !== 0)) out.push([Math.round(o.position.x), Math.round(o.position.z)]);
        });
        return out;
      },
      /** Visible meshes per top-level scene group (and how many cast shadows). */
      meshes() {
        const out: Record<string, { meshes: number; shadow: number; tris: number }> = {};
        const groups: THREE.Object3D[] = [];
        for (const top of app.scene.children) groups.push(...(top.type === 'Group' && !top.name ? top.children : [top]));
        for (const top of groups) {
          const key = top.name || top.type;
          const e = (out[key] ??= { meshes: 0, shadow: 0, tris: 0 });
          top.traverseVisible((o) => {
            const m = o as THREE.Mesh;
            if (!m.isMesh) return;
            e.meshes++;
            if (m.castShadow) e.shadow++;
            const g = m.geometry;
            const n = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3;
            e.tris += Math.round(n * ((m as THREE.InstancedMesh).count ?? 1));
          });
        }
        return out;
      },
      /** Draw calls, triangles and GPU memory of the last frame's main scene render. */
      stats() {
        const gl = app.renderer.gl;
        gl.info.autoReset = false;
        gl.info.reset();
        app.advance(0);
        const r = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, programs: gl.info.programs?.length ?? 0 };
        gl.info.autoReset = true;
        return r;
      },
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
    /** Show a banner like the medal and achievement ones (unlocks nothing). */
    banner(title = 'UNLOCKED: DEMOLITION DERBY', text = 'WRECK 3 CARS IN ONE RACE', color?: string) {
      app.showBanner(title, text, color);
    },
    /** Freeze or resume the simulation (rendering continues). */
    pause(on = true) {
      app.paused = on;
    },
    /** Let the AI drive the player car (demo / testing). */
    autopilot(on = true) {
      app.spoilAchievements();
      app.player.aiDriven = on ? 1 : 0;
    },
    reset() {
      app.spoilAchievements();
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
    /** Open the controls screen; read the current bindings. */
    /**
     * Determinism check for the record boards: drive a race in this browser
     * with a simple line follower and return what the server should measure.
     */
    recordSelfTest(track = 'frostring', seconds = 120) {
      const spec: RaceSpec = {
        id: 0, track, laps: 0, seed: 4242, countdownTicks: 0, weapons: false,
        entrants: [{ name: 'AI', color: '#fff', playerId: -1, skill: 0.95 }, { name: 'YOU', color: '#f00', playerId: 0, skill: 0.9 }],
      };
      const { track: t, world, tunings } = createRaceWorld(spec, DEFAULT_TUNING);
      const car = world.cars[1];
      const inputs: CarInput[] = world.cars.map(() => neutralInput());
      const rec = new ReplayRecorder();
      for (let n = 0; n < seconds * 60; n++) {
        const j = (car.trackIdx + 14) % t.n;
        let d = Math.atan2(t.px[j] - car.x, -(t.pz[j] - car.z)) - car.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        inputs[1].steer = Math.max(-1, Math.min(1, d * 2.5));
        inputs[1].throttle = Math.abs(d) > 0.5 ? 0.5 : 1;
        quantizeInput(inputs[1]);
        rec.add(inputs[1]);
        stepWorld(world, t, inputs, tunings);
      }
      return { best: car.bestLapTicks, sub: { v: PROTOCOL_VERSION, name: 'SELFTEST', spec, replay: rec.encode() } };
    },
    /** The podium scene: null when it is not up, else how long it has been showing. */
    podiumState() {
      const p = (app as unknown as { podium: { time: number; entries: { name: string }[] } | null }).podium;
      return p ? { time: +p.time.toFixed(2), names: p.entries.map((e) => e.name) } : null;
    },
    /** Start a slow-motion beat now (testing; ignores the option and the cooldown). */
    slowmo(slowTime = true) {
      app.slowmo.enabled = true;
      app.slowmo.reset();
      return app.slowmo.trigger(0, slowTime);
    },
    /** Slow-motion state: time scale, depth of the beat. */
    slowmoState() {
      return { scale: +app.slowmo.timeScale.toFixed(3), depth: +app.slowmo.depth.toFixed(3), pitch: +app.slowmo.pitch.toFixed(3) };
    },
    /** What the lap-record recorder holds for the race now (ticks recorded vs ticks run), and the submission to check. */
    replayInfo() {
      const r = (app as unknown as { replay: ReplayRecorder | null; session: { spec?: RaceSpec } }).replay;
      const spec = (app.session as { spec?: RaceSpec }).spec;
      return r && spec ? { recorded: r.ticks, tick: app.world.tick, spec, replay: r.encode(), best: app.player.bestLapTicks } : null;
    },
    /** Time trial: ghosts, gap and readout (null outside a time trial). */
    timeTrial() {
      const a = app as unknown as { timeTrial: TimeTrial | null };
      return a.timeTrial?.debugState() ?? null;
    },
    /** A world board entry's ghost, re-run here as the time trial does: its lap time against the board's. */
    async worldGhost(track = 'frostring', league: League = 'standard', rank = 1) {
      const e = (await fetchBoards())?.[boardKey(track, league)]?.[rank - 1];
      if (!e) return { error: 'no entry' };
      const t0 = performance.now();
      const g = await loadWorldGhost(e, boardKey(track, league));
      return typeof g === 'string' ? { error: g, board: e.ticks } : { board: e.ticks, ghost: g.ticks, bytes: g.data.byteLength, ms: Math.round(performance.now() - t0) };
    },
    /** Keep the last lap driven (autopilot laps don't count as records) as your ghost here. */
    keepLapAsMyGhost() {
      const a = app as unknown as { timeTrial: TimeTrial | null; lapTape: LapTape | null };
      const lap = a.lapTape?.last;
      if (!lap) return 0;
      const s = app.session as unknown as { spec: { league?: League } };
      saveMyGhost(boardKey(app.session.track.def.id, s.spec.league), lap);
      a.timeTrial?.setMine(lap);
      return lap.ticks;
    },
    /** The active menu: labels and where to tap each row (CSS pixels). */
    menu() {
      const m = app.activeMenu;
      if (!m) return null;
      const rect = app.renderer.canvas.getBoundingClientRect();
      const k = rect.width / app.renderer.ui.w;
      return {
        mode: app.mode,
        index: m.index,
        rows: m.hitRects.map((r) => ({ item: r.item, label: r.item >= 0 ? m.items[r.item].label() : r.item === -1 ? 'UP' : 'DOWN', x: rect.left + (r.x + r.w / 2) * k, y: rect.top + (r.y + r.h / 2) * k })),
      };
    },
    recordNote() {
      return (app as unknown as { recordNote: string }).recordNote;
    },
    focused() {
      const el = document.activeElement;
      return el ? el.tagName : null;
    },
    touch() {
      const t = app.touch;
      return { enabled: t.enabled, visible: t.visible, steer: +t.steer.toFixed(2), throttle: t.throttle, brake: t.brake, buttons: t.buttons, ui: [app.renderer.ui.w, app.renderer.ui.h, app.renderer.uiScale] };
    },
    openControls() {
      app.mode = 'controls';
    },
    controls() {
      return JSON.parse(JSON.stringify(app.controls)) as unknown;
    },
    /** 'running', 'suspended' (page hidden), 'interrupted' (iPhone) or 'none'. */
    audioState() {
      return app.audio.ctx?.state ?? 'none';
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
      app.spoilAchievements();
      return app.tuning;
    },
    setTuning(values: Partial<CarTuning>) {
      app.spoilAchievements();
      Object.assign(app.tuning, values);
    },
  };
  (window as unknown as { __megacars: typeof api }).__megacars = api;
}
