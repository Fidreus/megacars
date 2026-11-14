// The podium scene after a race: the top three cars on first, second and third
// steps on a red carpet across the start straight, with confetti falling. It is
// built from the renderer's own parts (car meshes, toon materials, GPU
// particles) and viewed through the usual pixel camera, turned so the stage
// faces the viewer whatever way the start straight runs.

import * as THREE from 'three';
import { disposeTree } from './disposeTree.ts';
import type { League } from '../../shared/game/leagues.ts';
import type { Track } from '../../shared/track/types.ts';
import { CarView, MODEL_STYLE } from './carMesh.ts';
import type { PaintLook } from '../game/paints.ts';
import { toon } from './materials.ts';
import type { PixelCamera } from './pixelCamera.ts';
import { Particles } from './particles.ts';

export interface PodiumEntry {
  /** Car id. */
  id: number;
  name: string;
  color: string;
  /** Car model (index into CAR_MODELS) or -1. */
  model: number;
  /** A person at this screen (not a computer driver or somebody online). */
  local: boolean;
  /** The pattern of a paint job, if any. */
  look?: PaintLook;
}

/** Where the podium stands: this many samples (about metres) past the start line. */
const STAGE_AT = 34;
const STEP_W = 4.6;
const STEP_D = 5.9;
/** Heights of 1st, 2nd and 3rd. */
const HEIGHTS = [1.9, 1.3, 0.8];
/** Sideways position of 1st, 2nd and 3rd (in step widths): 2nd on the left, 3rd on the right. */
const SLOT = [0, -1, 1];
const MEDAL = ['#ffd84a', '#d3dae6', '#cf8a4c'];
// Just over 1 so they are drawn unlit and crisp but do not bloom.
const CONFETTI = [[1.7, 0.3, 0.3], [0.3, 1.5, 0.4], [0.4, 0.8, 1.9], [1.8, 1.6, 0.3], [1.6, 0.35, 1.6], [0.35, 1.6, 1.6], [1.8, 0.9, 0.25]];

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export interface PodiumLabel {
  entry: PodiumEntry;
  /** 0 = 1st. */
  place: number;
  /** World points: above the car, and on the front of its step. */
  head: THREE.Vector3;
  front: THREE.Vector3;
}

export class Podium {
  readonly entries: PodiumEntry[];
  readonly group = new THREE.Group();
  /** Seconds since the podium appeared. */
  time = 0;
  /** Someone at this screen is on the podium: more confetti, a bigger fuss. */
  readonly occasion: boolean;
  private readonly scene: THREE.Scene;
  private readonly cars: CarView[] = [];
  private readonly steps: THREE.Mesh[] = [];
  private readonly particles = new Particles();
  /** Camera yaw that puts the stage's front toward the viewer. */
  private readonly yaw: number;
  private readonly origin = new THREE.Vector3();
  private readonly labels: PodiumLabel[] = [];
  private burst = false;
  private spawnDebt = 0;

  constructor(scene: THREE.Scene, track: Track, entries: PodiumEntry[], league: League | undefined, lightsOn: boolean, headlight: number) {
    this.scene = scene;
    this.entries = entries.slice(0, 3);
    this.occasion = this.entries.some((e) => e.local);
    const i = STAGE_AT % track.n;
    this.yaw = Math.atan2(track.tz[i], track.tx[i]);
    this.origin.set(track.px[i], 0, track.pz[i]);
    this.group.position.copy(this.origin);
    this.group.rotation.y = -this.yaw;
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(STEP_W * 3 + 5, 0.08, STEP_D + 3.4), toon('#7a1426'));
    carpet.position.y = 0.05;
    carpet.receiveShadow = true;
    this.group.add(carpet);
    this.entries.forEach((e, place) => {
      const h = HEIGHTS[place];
      const mats = [0, 1, 2, 3, 4, 5].map((f) => toon(f === 2 ? MEDAL[place] : f === 4 ? '#8d95a8' : '#5d6475'));
      const step = new THREE.Mesh(new THREE.BoxGeometry(STEP_W, h, STEP_D), mats);
      step.position.set(SLOT[place] * STEP_W, 0, 0);
      step.castShadow = step.receiveShadow = true;
      this.group.add(step);
      this.steps.push(step);
      const style = e.model >= 0 ? MODEL_STYLE[e.model] : undefined;
      const car = new CarView(e.color, e.id + 1, style, league, e.look);
      car.setLights(lightsOn, headlight);
      this.group.add(car.root);
      this.cars.push(car);
      this.labels.push({ entry: e, place, head: new THREE.Vector3(), front: new THREE.Vector3() });
    });
    this.particles.points.frustumCulled = false;
    this.layout(0);
    scene.add(this.group, this.particles.points);
  }

  dispose(): void {
    this.scene.remove(this.group, this.particles.points);
    disposeTree(this.group);
    disposeTree(this.particles.points);
  }

  /** How far a step has risen (0..1): 3rd first, then 2nd, then 1st. */
  private rise(place: number): number {
    return smooth((this.time - (2 - place) * 0.22) / 0.5);
  }

  private layout(dt: number): void {
    const t = this.time;
    this.entries.forEach((e, place) => {
      const r = this.rise(place);
      const h = HEIGHTS[place] * Math.max(0.001, r);
      const step = this.steps[place];
      step.scale.y = Math.max(0.001, r);
      step.position.y = h / 2;
      // A gentle sway, and a hop when the step has just finished rising (the winner keeps hopping).
      const settled = Math.max(0, t - (2 - place) * 0.22 - 0.5);
      const hop = place === 0 || e.local ? Math.abs(Math.sin(Math.min(settled, 6) * 5)) * (place === 0 ? 0.35 : 0.2) * Math.exp(-settled * (place === 0 ? 0.25 : 0.9)) : 0;
      const x = SLOT[place] * STEP_W;
      this.cars[place].update(x, h + hop, 0, Math.PI + Math.sin(t * 0.9 + place * 1.7) * 0.5 + (place === 1 ? 0.3 : place === 2 ? -0.3 : 0), 0, 0, 0, false, 0, dt);
      const lab = this.labels[place];
      lab.head.set(x, h + 3.9, 0);
      lab.front.set(x, h * 0.5, STEP_D / 2);
      this.group.localToWorld(lab.head);
      this.group.localToWorld(lab.front);
    });
  }

  update(dt: number, pxScale: number, light: number, dither: boolean): void {
    this.time += dt;
    this.layout(dt);
    const p = this.particles;
    p.time.value = this.time;
    p.pxScale.value = pxScale;
    p.light.value = light;
    p.dither.value = dither ? 1 : 0;
    // Confetti from above the stage: a burst when the winner's step is up, then a steady fall.
    if (!this.burst && this.time > 0.5) {
      this.burst = true;
      this.confetti(this.occasion ? 200 : 100);
    }
    if (this.time > 0.5) {
      this.spawnDebt += dt * (this.occasion ? 80 : 40);
      const n = Math.floor(this.spawnDebt);
      this.spawnDebt -= n;
      this.confetti(n);
    }
    p.flush();
  }

  private readonly tmp = new THREE.Vector3();

  private confetti(n: number): void {
    const R = Math.random;
    for (let i = 0; i < n; i++) {
      const c = CONFETTI[Math.floor(R() * CONFETTI.length)];
      this.tmp.set((R() - 0.5) * 24, 10 + R() * 8, (R() - 0.5) * 14);
      this.group.localToWorld(this.tmp);
      this.particles.spawn(
        this.tmp.x, this.tmp.y, this.tmp.z, (R() - 0.5) * 2.4, 2 - R() * 3, (R() - 0.5) * 2.4,
        3.6, 1.1, 0.9, c[0], c[1], c[2], -3.2, 0.9,
      );
    }
  }

  /** Frame the stage: faces the viewer, a slow push-in. */
  aim(cam: PixelCamera, w: number, h: number): void {
    const aspect = w / h;
    // At least 22 m of stage width on screen, whatever the shape of the window.
    const base = Math.max(13, 17 / aspect);
    cam.follow = true;
    cam.yaw = this.yaw;
    cam.tilt = 38 * (Math.PI / 180);
    cam.viewHeight = base * (1.25 - 0.25 * smooth(this.time / 2.2));
    const c = this.center();
    cam.update(c.x, c.y, c.z, w, h);
  }

  /** The point the camera looks at (world). */
  center(): THREE.Vector3 {
    const c = this.tmp.set(0, 1.6, 0.4);
    return this.group.localToWorld(c).clone();
  }

  /** Where to put names and places (world points). */
  get points(): readonly PodiumLabel[] {
    return this.labels;
  }
}
