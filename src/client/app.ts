// M1 drift sandbox: one player car (plus optional AI cars) on a track, with
// the retro renderer, live tuning, telemetry and sound.

import * as THREE from 'three';
import { DT } from '../shared/config/constants.ts';
import { SURFACES, Surface } from '../shared/config/surfaces.ts';
import { cloneTuning, DEFAULT_TUNING, type CarTuning } from '../shared/config/tuning.ts';
import { buildTrack, surfaceAt } from '../shared/track/builder.ts';
import { TRACKS, DEFAULT_TRACK } from '../shared/track/defs/index.ts';
import type { Track } from '../shared/track/types.ts';
import type { CarState } from '../shared/sim/car.ts';
import { Ev } from '../shared/sim/events.ts';
import { neutralInput, type CarInput } from '../shared/sim/input.ts';
import { resetProgress } from '../shared/sim/race.ts';
import { stepWorld } from '../shared/sim/step.ts';
import { createWorld, respawnCar, type World } from '../shared/sim/world.ts';
import { AudioSystem } from './audio/audio.ts';
import { EngineSound } from './audio/engine.ts';
import { playImpact, SkidSound } from './audio/sfx.ts';
import { installDebugApi } from './debug/debugApi.ts';
import { buildTrackDebugView } from './debug/trackDebugView.ts';
import { loadSavedTuning, openTuningPanel } from './debug/tuningPanel.ts';
import { SOLO_KEYS } from './input/bindings.ts';
import { InputManager } from './input/inputManager.ts';
import type { Params } from './params.ts';
import { CarView } from './render/carMesh.ts';
import { CAR_COLORS } from './render/materials.ts';
import { MOODS, moodById, type Mood } from './render/mood.ts';
import { PALETTE_MODE_NAMES, type PaletteModeId } from './render/palette.ts';
import { RetroRenderer } from './render/renderer.ts';
import { buildScenery } from './render/scenery.ts';
import { buildProps } from './render/props.ts';
import { animTime } from './render/materials.ts';
import { SkidMarks } from './render/skidmarks.ts';
import { Effects } from './render/effects.ts';
import { Particles } from './render/particles.ts';
import { buildTrackView } from './render/trackMesh.ts';
import { PingProbe } from './session/pingProbe.ts';
import { drawText } from './ui/font.ts';

const SHADOW_HALF = 62;
const SHADOW_MAP = 2048;
const PAVED = new Set<number>([Surface.Asphalt, Surface.Curb, Surface.Wet]);

interface Pose {
  x: number;
  z: number;
  y: number;
  heading: number;
}

export class App {
  readonly renderer: RetroRenderer;
  readonly scene = new THREE.Scene();
  readonly track: Track;
  readonly world: World;
  readonly tuning: CarTuning;
  readonly input = new InputManager();
  readonly lookAhead = { value: 0.3 };
  private readonly params: Params;
  private readonly tunings: CarTuning[];
  private readonly inputs: CarInput[];
  private readonly carViews: CarView[] = [];
  private readonly prev: Pose[] = [];
  private readonly skid = new SkidMarks();
  private readonly particles = new Particles();
  private readonly effects: Effects;
  private readonly sun = new THREE.DirectionalLight('#fff0d4', 2.4);
  private readonly debugView: THREE.Group;
  private readonly audio = new AudioSystem();
  private readonly ping = new PingProbe();
  private engine: EngineSound | null = null;
  private skidSound: SkidSound | null = null;
  private tuningPanel: { toggle(): void } | null = null;
  private acc = 0;
  private last = -1;
  private readonly camTargets = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly camInit = [false, false];
  /** Which car each viewport follows. */
  readonly viewCar = [0, 1];
  private baseView = 51.3;
  private showTelemetry: boolean;
  private fpsTime = 0;
  private fpsFrames = 0;
  fps = 0;
  /** Freeze the simulation (debug/screenshots); rendering continues. */
  paused = false;
  private flash = '';
  private flashTime = 0;
  private padIndex = -1;
  private readonly sunRight = new THREE.Vector3();
  private readonly sunUp = new THREE.Vector3();
  private readonly sunDir = new THREE.Vector3(0, 1, 0);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#000000', 1);
  private readonly nightLights: THREE.Object3D[] = [];
  private lampBulbs: THREE.MeshBasicMaterial | null = null;
  private lampPools: THREE.MeshBasicMaterial | null = null;
  mood: Mood = MOODS[0];

  constructor(canvas: HTMLCanvasElement, params: Params) {
    this.params = params;
    this.renderer = new RetroRenderer(canvas, params.scale);
    this.renderer.crt = params.scanlines ? 1 : 0;
    const cam = this.renderer.viewports[0].cam;
    if (params.mpp) cam.viewHeight = params.mpp * 270;
    this.baseView = cam.viewHeight;

    this.tuning = cloneTuning(DEFAULT_TUNING);
    loadSavedTuning(this.tuning);
    this.tunings = [this.tuning];

    const def = TRACKS[params.track] ?? TRACKS[DEFAULT_TRACK];
    this.track = buildTrack(def);
    this.world = createWorld(this.track, 1 + params.ai, params.seed);
    this.inputs = this.world.cars.map(() => neutralInput());
    this.world.cars.forEach((car, i) => {
      if (i > 0) {
        car.aiDriven = 1;
        car.aiSkill = 0.9 + 0.1 * ((i * 37) % 10) / 10;
      }
      const view = new CarView(CAR_COLORS[i % CAR_COLORS.length], i + 1);
      this.carViews.push(view);
      this.scene.add(view.root);
      this.prev.push({ x: car.x, z: car.z, y: car.y, heading: car.heading });
    });

    this.effects = new Effects(this.particles, this.track);
    this.buildScene();
    this.setMood(moodById(params.mood));
    this.debugView = buildTrackDebugView(this.track, this.tuning);
    this.scene.add(this.debugView);
    this.showTelemetry = params.debug;
    if (params.debug) {
      this.debugView.visible = true;
      void this.openTuning();
    }
    this.ping.start();
    installDebugApi(this);

    const unlock = () => {
      if (this.params.mute) return;
      this.audio.unlock();
      if (!this.engine && this.audio.ctx) {
        this.engine = new EngineSound(this.audio);
        this.skidSound = new SkidSound(this.audio);
      }
    };
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
    canvas.focus();
  }

  private buildScene(): void {
    this.scene.add(this.hemi);
    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF;
    sc.right = SHADOW_HALF;
    sc.top = SHADOW_HALF;
    sc.bottom = -SHADOW_HALF;
    sc.near = 1;
    sc.far = 500;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);

    this.scene.add(buildTrackView(this.track));
    const props = buildProps(this.track);
    this.scene.add(props.group);
    this.nightLights.push(...props.nightLights);
    this.lampBulbs = props.bulbs;
    this.lampPools = props.pools;
    this.scene.add(buildScenery(this.track, props.keepOut));
    this.scene.add(this.skid.mesh);
    this.scene.add(this.particles.points);
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    this.scene.background = new THREE.Color(mood.background);
    this.hemi.color.set(mood.skyColor);
    this.hemi.groundColor.set(mood.groundColor);
    this.hemi.intensity = mood.hemiIntensity;
    this.sun.color.set(mood.sunColor);
    this.sun.intensity = mood.sunIntensity;
    this.sunDir.copy(mood.sunDir);
    // Light-space basis matching the shadow camera's lookAt (world up = +y).
    this.sunRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this.sunUp.crossVectors(this.sunDir, this.sunRight).normalize();
    const g = this.renderer.grade;
    g.tint.copy(mood.tint);
    g.lift.copy(mood.lift);
    g.exposure = mood.exposure;
    g.bloom = mood.bloom;
    g.bloomThreshold = mood.bloomThreshold;
    this.particles.light.value = mood.particleLight;
    this.lampBulbs?.color.setRGB(mood.lights ? 5 : 0.55, mood.lights ? 4.4 : 0.55, mood.lights ? 3.2 : 0.5);
    for (const o of this.nightLights) o.visible = mood.lights;
    this.lampPools?.color.setRGB(0.95 * mood.lampLight, 0.8 * mood.lampLight, 0.56 * mood.lampLight);
    for (const v of this.carViews) v.setLights(mood.lights, mood.headlight);
  }

  async openTuning(): Promise<void> {
    if (this.tuningPanel) {
      this.tuningPanel.toggle();
      return;
    }
    this.tuningPanel = await openTuningPanel(this.tuning, { cam: this.renderer.viewports[0].cam, lookAhead: this.lookAhead });
  }

  get player(): CarState {
    return this.world.cars[0];
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (nowMs: number): void => {
    requestAnimationFrame(this.frame);
    const now = nowMs / 1000;
    if (this.last < 0) this.last = now;
    const dt = Math.min(0.1, now - this.last);
    this.last = now;
    this.handleKeys();
    this.acc = this.paused ? 0 : this.acc + dt;
    let steps = 0;
    while (this.acc >= DT && steps < 6) {
      this.fixedStep();
      this.acc -= DT;
      steps++;
    }
    if (steps === 6) this.acc = 0;
    this.renderFrame(this.acc / DT, dt);
    this.input.keyboard.endFrame();
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  };

  /** Run `ticks` simulation steps immediately and render one frame (testing). */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.fixedStep();
    this.renderFrame(0, ticks * DT);
  }

  private handleKeys(): void {
    const kb = this.input.keyboard;
    if (kb.wasPressed('KeyR')) this.resetPlayer();
    if (kb.wasPressed('Digit1')) this.debugView.visible = !this.debugView.visible;
    if (kb.wasPressed('Digit2')) this.showTelemetry = !this.showTelemetry;
    if (kb.wasPressed('Digit3')) {
      this.renderer.crt = (this.renderer.crt + 1) % 3;
      this.flashMessage(['CRT OFF', 'CRT SCANLINES', 'CRT FULL'][this.renderer.crt]);
    }
    if (kb.wasPressed('Digit4')) {
      this.renderer.paletteMode = ((this.renderer.paletteMode + 1) % 3) as PaletteModeId;
      this.flashMessage(PALETTE_MODE_NAMES[this.renderer.paletteMode]);
    }
    if (kb.wasPressed('KeyV')) this.toggleSplit();
    if (kb.wasPressed('KeyM')) {
      this.setMood(MOODS[(MOODS.indexOf(this.mood) + 1) % MOODS.length]);
      this.flashMessage(this.mood.name);
    }
    if (kb.wasPressed('Digit0')) void this.openTuning();
    if (kb.wasPressed('KeyP')) {
      this.player.aiDriven = this.player.aiDriven ? 0 : 1;
      this.flashMessage(this.player.aiDriven ? 'AUTOPILOT ON' : 'AUTOPILOT OFF');
    }
    const pad = this.input.firstActivePad();
    if (pad >= 0) this.padIndex = pad;
  }

  resetPlayer(): void {
    const car = this.player;
    respawnCar(car, this.track, car.trackS);
    resetProgress(car, this.track);
    this.skid.mark(0, 0, 0, false);
    this.flashMessage('RESET');
  }

  private flashMessage(text: string, seconds = 1.6): void {
    this.flash = text;
    this.flashTime = seconds;
  }

  private fixedStep(): void {
    this.input.sample({ keys: SOLO_KEYS, pad: this.padIndex }, this.inputs[0]);
    const cars = this.world.cars;
    for (let i = 0; i < cars.length; i++) {
      const p = this.prev[i];
      p.x = cars[i].x;
      p.z = cars[i].z;
      p.y = cars[i].y;
      p.heading = cars[i].heading;
    }
    stepWorld(this.world, this.track, this.inputs, this.tunings);
    const ev = this.world.events;
    for (let k = 0; k < ev.count; k++) {
      const e = ev.list[k];
      if ((e.kind === Ev.WallHit || e.kind === Ev.CarHit) && this.audio.ready) {
        const dx = e.x - this.player.x;
        const dz = e.z - this.player.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 60) playImpact(this.audio, e.value * (1 - dist / 60), dx / 30);
      } else if (e.kind === Ev.Lap && e.car === 0) {
        const best = this.player.bestLapTicks === e.value;
        this.flashMessage(`${best ? 'BEST ' : 'LAP '}${formatTime(e.value * DT)}`, 2.5);
      }
    }
    for (const car of cars) this.emitSkids(car);
    this.effects.tick(this.world);
  }

  private emitSkids(car: CarState): void {
    const speed = Math.hypot(car.vx, car.vz);
    const slipDeg = (Math.abs(car.slip) * 180) / Math.PI;
    const sliding = (car.sliding === 1 || car.spinTicks > 0) && slipDeg > 4 && speed > 5;
    const hardBrake = car.longAccel < -12 && speed > 10;
    const fx = Math.sin(car.heading);
    const fz = -Math.cos(car.heading);
    const rx = Math.cos(car.heading);
    const rz = Math.sin(car.heading);
    for (let w = 0; w < 4; w++) {
      const rear = w < 2;
      const side = w % 2 === 0 ? -0.97 : 0.97;
      const along = rear ? -1.42 : 1.38;
      const x = car.x + rx * side + fx * along;
      const z = car.z + rz * side + fz * along;
      const on = car.airborne === 0 && (sliding || hardBrake) && (rear || slipDeg > 14 || hardBrake) && PAVED.has(surfaceAt(this.track, x, z));
      this.skid.mark(car.id * 4 + w, x, z, on);
    }
  }

  private renderFrame(alpha: number, dt: number): void {
    const cars = this.world.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const p = this.prev[i];
      let dh = c.heading - p.heading;
      if (dh > Math.PI) dh -= Math.PI * 2;
      else if (dh < -Math.PI) dh += Math.PI * 2;
      this.carViews[i].update(
        p.x + (c.x - p.x) * alpha,
        p.y + (c.y - p.y) * alpha,
        p.z + (c.z - p.z) * alpha,
        p.heading + dh * alpha,
        c.steer,
        c.latAccel,
        c.longAccel,
        (c.brakeTicks > 0 || c.longAccel < -10) && Math.hypot(c.vx, c.vz) > 1,
        Math.hypot(c.vx, c.vz),
        dt,
      );
    }

    const views = this.renderer.viewCount;
    for (let v = 0; v < views; v++) this.updateCamera(v, dt);
    this.particles.time.value = (this.world.tick + alpha) * DT;
    this.particles.dither.value = this.renderer.paletteMode === 0 ? 0 : 1;
    animTime.value = performance.now() / 1000;
    this.particles.flush();
    this.updateAudio();
    this.drawHud(dt);
    for (let v = 0; v < views; v++) {
      this.updateSun(this.camTargets[v]);
      this.particles.pxScale.value = 0.19 / this.renderer.viewports[v].cam.metersPerPixel;
      this.renderer.renderView(this.scene, v);
    }
    this.renderer.present();
  }

  /** Follow a car with look-ahead in its direction of travel. */
  private updateCamera(v: number, dt: number): void {
    const vp = this.renderer.viewports[v];
    const cam = vp.cam;
    const idx = Math.min(this.viewCar[v], this.world.cars.length - 1);
    const car = this.world.cars[idx];
    const view = this.carViews[idx].root.position;
    const half = cam.footprint(vp.w, vp.h);
    const maxLead = Math.min(half.width, half.depth) * 0.3;
    let lx = car.vx * this.lookAhead.value;
    let lz = car.vz * this.lookAhead.value;
    const ll = Math.hypot(lx, lz);
    if (ll > maxLead) {
      lx *= maxLead / ll;
      lz *= maxLead / ll;
    }
    const tx = view.x + lx;
    const tz = view.z + lz;
    const target = this.camTargets[v];
    if (!this.camInit[v]) {
      target.set(tx, 0, tz);
      this.camInit[v] = true;
    } else {
      const k = 1 - Math.exp(-7 * dt);
      target.x += (tx - target.x) * k;
      target.z += (tz - target.z) * k;
    }
    cam.update(target.x, 0, target.z, vp.w, vp.h);
  }

  /** Debug split screen: the second view follows car 1. */
  toggleSplit(): void {
    const r = this.renderer;
    r.setSplit(!r.isSplit);
    const base = r.viewports[0].cam;
    const view = r.isSplit ? this.baseView * 1.25 : this.baseView;
    for (const vp of r.viewports) {
      vp.cam.viewHeight = view;
      vp.cam.tilt = base.tilt;
    }
    this.camInit[1] = false;
  }

  /**
   * Pixel-crawl test: render, move the camera exactly k low-res pixels right
   * (then up), render again and compare the overlapping static image. Cars,
   * particles and animation are frozen/hidden. Returns the share of identical pixels.
   */
  crawlTest(k = 8): { horizontal: number; vertical: number } {
    const wasPaused = this.paused;
    this.paused = true;
    const hidden: THREE.Object3D[] = [...this.carViews.map((c) => c.root), this.particles.points];
    for (const o of hidden) o.visible = false;
    const frozen = animTime.value;
    const vp = this.renderer.viewports[0];
    const cam = vp.cam;
    const base = this.camTargets[0].clone();
    const p = cam.metersPerPixel;
    const shot = (tx: number, tz: number) => {
      const t = new THREE.Vector3(tx, 0, tz);
      cam.update(tx, 0, tz, vp.w, vp.h);
      this.updateSun(t);
      animTime.value = frozen;
      this.particles.pxScale.value = 0.19 / cam.metersPerPixel;
      this.renderer.renderView(this.scene, 0);
      const out = vp.post.out;
      const buf = new Uint8Array(out.width * out.height * 4);
      this.renderer.gl.readRenderTargetPixels(out, 0, 0, out.width, out.height, buf);
      return { buf, w: out.width, h: out.height };
    };
    const a = shot(base.x, base.z);
    const b = shot(base.x + k * p, base.z);
    const c = shot(base.x, base.z - (k * p) / Math.sin(cam.tilt));
    const compare = (A: typeof a, B: typeof a, dx: number, dy: number) => {
      let same = 0;
      let total = 0;
      for (let y = k + 2; y < A.h - k - 2; y++) {
        for (let x = k + 2; x < A.w - k - 2; x++) {
          const ia = ((y + dy) * A.w + (x + dx)) * 4;
          const ib = (y * B.w + x) * 4;
          total++;
          if (A.buf[ia] === B.buf[ib] && A.buf[ia + 1] === B.buf[ib + 1] && A.buf[ia + 2] === B.buf[ib + 2]) same++;
        }
      }
      return same / total;
    };
    const result = { horizontal: compare(a, b, k, 0), vertical: compare(a, c, 0, k) };
    for (const o of hidden) o.visible = true;
    this.paused = wasPaused;
    return result;
  }

  /** Average milliseconds to simulate + render a frame (synchronised with the GPU). */
  bench(frames = 120): { msPerFrame: number; lowRes: [number, number]; views: number } {
    const gl = this.renderer.gl;
    const px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      this.fixedStep();
      this.renderFrame(0, DT);
    }
    gl.readRenderTargetPixels(this.renderer.viewports[0].post.out, 0, 0, 1, 1, px);
    return {
      msPerFrame: +((performance.now() - t0) / frames).toFixed(2),
      lowRes: [this.renderer.lowW, this.renderer.lowH],
      views: this.renderer.viewCount,
    };
  }

  /** Keep the shadow map centred on the view, snapped to whole shadow texels. */
  private updateSun(target: THREE.Vector3): void {
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
    const r = Math.round(target.dot(this.sunRight) / texel) * texel;
    const u = Math.round(target.dot(this.sunUp) / texel) * texel;
    const f = target.dot(this.sunDir);
    const t = this.sun.target.position;
    t.copy(this.sunRight).multiplyScalar(r).addScaledVector(this.sunUp, u).addScaledVector(this.sunDir, f);
    this.sun.position.copy(t).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  private updateAudio(): void {
    const ctx = this.audio.ctx;
    if (!ctx || !this.engine || !this.skidSound) return;
    const now = ctx.currentTime;
    const car = this.player;
    const speed = Math.hypot(car.vx, car.vz);
    this.engine.update(speed / this.tuning.vTop, this.inputs[0].throttle, 1, 0, now);
    const slipDeg = (Math.abs(car.slip) * 180) / Math.PI;
    const paved = PAVED.has(car.surfRear);
    let amount = 0;
    if ((car.sliding || car.spinTicks > 0) && speed > 5) amount = Math.min(1, (slipDeg - 3) / 22) * Math.min(1, speed / 18);
    if (car.longAccel < -12 && speed > 8) amount = Math.max(amount, 0.55);
    this.skidSound.update(paved ? Math.max(0, amount) : 0, 0.5, now);
  }

  private drawHud(dt: number): void {
    const ui = this.renderer.ui;
    const ctx = ui.begin();
    const W = ui.w;
    const H = ui.h;
    const car = this.player;
    const speed = Math.hypot(car.vx, car.vz);
    const yellow = '#ffd84a';

    // Lap and times.
    const lapTime = car.lap > 0 ? (this.world.tick - car.lapStartTick) * DT : 0;
    drawText(ctx, car.lap > 0 ? `LAP ${car.lap}` : 'START', 6, 6, { color: yellow, scale: 2 });
    drawText(ctx, formatTime(lapTime), 6, 24, { scale: 1 });
    if (car.lastLapTicks) drawText(ctx, `LAST ${formatTime(car.lastLapTicks * DT)}`, 6, 34, { color: '#b8c8ff' });
    if (car.bestLapTicks) drawText(ctx, `BEST ${formatTime(car.bestLapTicks * DT)}`, 6, 43, { color: '#9cff9c' });

    // Speedometer.
    const kmh = Math.round(speed * 3.6);
    drawText(ctx, `${kmh}`, 6, H - 22, { scale: 2, color: '#ffffff' });
    drawText(ctx, 'KM/H', 10 + String(kmh).length * 12, H - 15, { color: '#c0c0c0' });
    if (car.wrongWayTicks > 90) drawText(ctx, 'WRONG WAY!', W / 2, H / 2 - 40, { scale: 2, color: '#ff4a3a', align: 'center' });

    if (this.world.tick < 60 * 20) {
      drawText(ctx, 'DRIFT: LET GO OF GAS + PRESS AGAIN WHILE TURNING', W / 2, H - 34, { color: '#ffd84a', align: 'center' });
    }
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      drawText(ctx, this.flash, W / 2, 30, { scale: 2, color: yellow, align: 'center' });
    }

    if (this.renderer.isSplit) {
      const v1 = this.renderer.viewports[1];
      ctx.fillStyle = '#000';
      ctx.fillRect(v1.x - 2, 0, 2, H);
    }
    if (this.showTelemetry) this.drawTelemetry(ctx, 10, 56);
    if (this.world.tick < 60 * 12 || this.showTelemetry) {
      drawText(ctx, 'R:RESET M:MOOD 3:CRT 4:COLOURS 2:INFO 0:TUNE', W - 4, H - 10, {
        color: '#d0d0d0', align: 'right', shadow: '#000',
      });
    }
    if (this.params.debug) {
      const rtt = this.ping.rtt >= 0 ? ` RTT ${this.ping.rtt.toFixed(0)}MS` : this.ping.connected ? '' : ' OFFLINE';
      drawText(ctx, `${this.fps.toFixed(0)} FPS ${this.renderer.lowW}X${this.renderer.lowH} X${this.renderer.scale}${rtt}`, W - 4, 4, {
        color: '#9cff9c', align: 'right',
      });
    }
    ui.end();
  }

  private drawTelemetry(ctx: CanvasRenderingContext2D, x: number, top: number): void {
    const car = this.player;
    let y = top;
    const slipDeg = (car.slip * 180) / Math.PI;
    const inp = this.inputs[0];
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 4, y - 3, 118, 84);
    const row = (label: string, value: string, color = '#ffffff') => {
      drawText(ctx, label, x, y, { color: '#9aa4b8' });
      drawText(ctx, value, x + 110, y, { color, align: 'right' });
      y += 9;
    };
    const state = car.spinTicks > 0 ? 'SPIN' : car.sliding ? 'SLIDE' : 'GRIP';
    row('STATE', state, car.spinTicks > 0 ? '#ff4a3a' : car.sliding ? '#ffd84a' : '#9cff9c');
    row('SLIP', `${slipDeg.toFixed(1)}°`);
    row('LAT G', (car.latAccel / 9.81).toFixed(2));
    row('YAW', `${car.angVel.toFixed(2)}`);
    row('SURFACE', SURFACES[car.surfRear]?.name.toUpperCase() ?? '?');
    row('DIST', `${car.raceDist.toFixed(0)} M`);
    // Steering, throttle and brake bars.
    const bar = (label: string, v: number, color: string, centered = false) => {
      drawText(ctx, label, x, y, { color: '#9aa4b8' });
      const bx = x + 36;
      const bw = 74;
      ctx.fillStyle = '#222';
      ctx.fillRect(bx, y, bw, 6);
      ctx.fillStyle = color;
      if (centered) {
        const mid = bx + bw / 2;
        const len = Math.round((v * bw) / 2);
        ctx.fillRect(Math.min(mid, mid + len), y, Math.abs(len) || 1, 6);
      } else {
        ctx.fillRect(bx, y, Math.round(v * bw), 6);
      }
      y += 9;
    };
    bar('STEER', car.steer, '#5ac8fa', true);
    bar('GAS', inp.throttle, '#9cff9c');
    bar('BRAKE', inp.brake, '#ff6b5e');
  }
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}
