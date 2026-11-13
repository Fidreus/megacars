// The paint shop's stage: the three car bodies (INTERCEPTOR, VIPER, BRUTE) side
// by side on a turntable-like carpet over the start straight, in the chosen
// paint and the league's look. Seen through the usual pixel camera, like the
// podium.

import * as THREE from 'three';
import type { League } from '../../shared/game/leagues.ts';
import type { Track } from '../../shared/track/types.ts';
import type { PaintLook } from '../game/paints.ts';
import { CarView, MODEL_STYLE } from './carMesh.ts';
import { toon } from './materials.ts';
import type { PixelCamera } from './pixelCamera.ts';

/** Where the stage stands: this many track samples past the start line. */
const STAGE_AT = 34;
const SPACING = 5.2;

export class Showroom {
  readonly group = new THREE.Group();
  time = 0;
  private readonly scene: THREE.Scene;
  private readonly yaw: number;
  private readonly origin = new THREE.Vector3();
  private cars: CarView[] = [];
  private readonly league: League;
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene, track: Track, league: League | undefined) {
    this.scene = scene;
    this.league = league ?? 'standard';
    const i = STAGE_AT % track.n;
    this.yaw = Math.atan2(track.tz[i], track.tx[i]);
    this.origin.set(track.px[i], 0, track.pz[i]);
    this.group.position.copy(this.origin);
    this.group.rotation.y = -this.yaw;
    const carpet = new THREE.Mesh(new THREE.BoxGeometry(SPACING * 3 + 2.5, 0.08, 9), toon('#2a3042'));
    carpet.position.y = 0.05;
    carpet.receiveShadow = true;
    this.group.add(carpet);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(SPACING * 3 + 2.5, 0.1, 0.35), toon('#ffd84a'));
    rim.position.set(0, 0.06, 4.6);
    this.group.add(rim);
    scene.add(this.group);
  }

  /** Show the three cars in this paint. */
  setPaint(color: string, look: PaintLook | undefined): void {
    for (const c of this.cars) this.group.remove(c.root);
    this.cars = MODEL_STYLE.map((style, k) => {
      const car = new CarView(color, k + 1, style, this.league, look);
      car.setLights(false, 0);
      this.group.add(car.root);
      return car;
    });
    this.layout(0);
  }

  dispose(): void {
    this.scene.remove(this.group);
  }

  private layout(dt: number): void {
    this.cars.forEach((car, k) => {
      const turn = Math.PI + Math.sin(this.time * 0.7 + k * 1.3) * 0.55;
      car.update((k - 1) * SPACING, 0.12, 0, turn, 0, 0, 0, false, 0, dt);
    });
  }

  update(dt: number): void {
    this.time += dt;
    this.layout(dt);
  }

  /** Frame the stage so that the three cars fill the width. */
  aim(cam: PixelCamera, w: number, h: number): void {
    const aspect = w / h;
    cam.follow = true;
    cam.yaw = this.yaw;
    cam.tilt = 44 * (Math.PI / 180);
    cam.viewHeight = Math.max(11, 19 / aspect);
    const c = this.center();
    cam.update(c.x, c.y, c.z, w, h);
  }

  center(): THREE.Vector3 {
    const c = this.tmp.set(0, 0.6, 0.3);
    return this.group.localToWorld(c).clone();
  }
}
