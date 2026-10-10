// Everything visual that belongs to one race: car models (interpolated between
// simulation ticks), skid marks, particles and the start lights.

import * as THREE from 'three';
import { DT } from '../../shared/config/constants.ts';
import { Surface } from '../../shared/config/surfaces.ts';
import { surfaceAt } from '../../shared/track/builder.ts';
import type { CarState } from '../../shared/sim/car.ts';
import { RacePhase } from '../../shared/sim/world.ts';
import { CarView, MODEL_STYLE } from '../render/carMesh.ts';
import { Effects } from '../render/effects.ts';
import { Particles } from '../render/particles.ts';
import { ShotView } from '../render/shotView.ts';
import { SkidMarks } from '../render/skidmarks.ts';
import type { GameSession } from './session.ts';

const PAVED = new Set<number>([Surface.Asphalt, Surface.Curb, Surface.Wet]);

interface Pose {
  x: number;
  z: number;
  y: number;
  heading: number;
}

export class RaceView {
  readonly session: GameSession;
  readonly cars: CarView[] = [];
  readonly particles = new Particles();
  private readonly skid = new SkidMarks();
  private readonly shots = new ShotView();
  readonly effects: Effects;
  private readonly prev: Pose[] = [];
  /** Visual offset left over from network corrections; decays to zero. */
  private readonly offset: Pose[] = [];
  private readonly group = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly lamps: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene, session: GameSession, lightsOn: boolean, headlight: number) {
    this.scene = scene;
    this.session = session;
    this.effects = new Effects(this.particles, session.track);
    for (const car of session.world.cars) {
      const model = session.models[car.id] ?? -1;
      const view = new CarView(session.colors[car.id], car.id + 1, model >= 0 ? MODEL_STYLE[model] : undefined);
      view.setLights(lightsOn, headlight);
      this.cars.push(view);
      this.group.add(view.root);
      this.prev.push({ x: car.x, z: car.z, y: car.y, heading: car.heading });
      this.offset.push({ x: 0, z: 0, y: 0, heading: 0 });
    }
    this.group.add(this.skid.mesh, this.particles.points, this.shots.group);
    scene.add(this.group);
    const gantry = scene.getObjectByName('gantry');
    for (let k = 0; k < 5; k++) {
      const lamp = gantry?.getObjectByName(`startLamp${k}`) as THREE.Mesh | undefined;
      if (lamp) this.lamps.push(lamp.material as THREE.MeshBasicMaterial);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    for (const m of this.lamps) m.color.set('#3a0d0d');
  }

  setLights(on: boolean, strength: number): void {
    for (const v of this.cars) v.setLights(on, strength);
  }

  /** Remember poses before a simulation step (for interpolation). */
  beforeStep(): void {
    const cars = this.session.world.cars;
    for (let i = 0; i < cars.length; i++) {
      const p = this.prev[i];
      p.x = cars[i].x;
      p.z = cars[i].z;
      p.y = cars[i].y;
      p.heading = cars[i].heading;
    }
  }

  /** Spawn tyre marks and particles after a simulation step. */
  afterStep(): void {
    for (const car of this.session.world.cars) this.emitSkids(car);
    this.effects.tick(this.session.world);
  }

  /** Teleports (respawn, reset) should not interpolate or leave a skid trail. */
  snap(id: number): void {
    const c = this.session.world.cars[id];
    Object.assign(this.prev[id], { x: c.x, z: c.z, y: c.y, heading: c.heading });
    for (let w = 0; w < 4; w++) this.skid.mark(id * 4 + w, c.x, c.z, false);
  }

  /**
   * The simulation state of cars jumped (a server correction): keep drawing
   * them where they were and glide to the corrected pose. Big jumps snap.
   */
  correct(drift: readonly { dx: number; dz: number; dh: number }[]): void {
    for (let i = 0; i < drift.length && i < this.prev.length; i++) {
      const d = drift[i];
      if (d.dx === 0 && d.dz === 0 && d.dh === 0) continue;
      const o = this.offset[i];
      if (Math.hypot(d.dx + o.x, d.dz + o.z) > 6) {
        o.x = o.z = o.heading = 0;
        this.snap(i);
        continue;
      }
      o.x += d.dx;
      o.z += d.dz;
      o.heading += d.dh;
      const p = this.prev[i];
      p.x -= d.dx;
      p.z -= d.dz;
      p.heading -= d.dh;
    }
  }

  update(alpha: number, dt: number, pxScale: number, particleDither: boolean): void {
    const world = this.session.world;
    const cars = world.cars;
    // Corrections fade out over ~0.1-0.2 s.
    const fade = Math.exp(-dt * 12);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const p = this.prev[i];
      const o = this.offset[i];
      o.x *= fade;
      o.z *= fade;
      o.heading *= fade;
      let dh = c.heading - p.heading;
      if (dh > Math.PI) dh -= Math.PI * 2;
      else if (dh < -Math.PI) dh += Math.PI * 2;
      const speed = Math.hypot(c.vx, c.vz);
      this.cars[i].update(
        p.x + (c.x - p.x) * alpha + o.x,
        p.y + (c.y - p.y) * alpha,
        p.z + (c.z - p.z) * alpha + o.z,
        p.heading + dh * alpha + o.heading,
        c.steer,
        c.latAccel,
        c.longAccel,
        (c.brakeTicks > 0 || c.longAccel < -10) && speed > 1,
        speed,
        dt,
      );
      this.cars[i].setWreck(c.wreckTicks > 0);
      // Ghosts (just respawned) blink.
      this.cars[i].root.visible = c.ghostTicks === 0 || c.finished === 1 || Math.floor(world.tick / 6) % 2 === 0;
    }
    this.shots.update(world.shots, alpha, world.tick);
    this.particles.time.value = (world.tick + alpha) * DT;
    this.particles.pxScale.value = pxScale;
    this.particles.dither.value = particleDither ? 1 : 0;
    this.particles.flush();
    this.updateStartLights();
  }

  /** Five red lights come on one by one; all out = go. */
  private updateStartLights(): void {
    const race = this.session.world.race;
    const t = this.session.world.tick;
    const lit = race.phase === RacePhase.Countdown ? lightsOn(t, race.startTick) : 0;
    this.lamps.forEach((m, k) => m.color.setRGB(k < lit ? 5 : 0.25, k < lit ? 0.35 : 0.05, k < lit ? 0.2 : 0.05));
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
      const side = w % 2 === 0 ? -0.98 : 0.98;
      const along = rear ? -1.42 : 1.4;
      const x = car.x + rx * side + fx * along;
      const z = car.z + rz * side + fz * along;
      const on = car.airborne === 0 && (sliding || hardBrake) && (rear || slipDeg > 14 || hardBrake) && PAVED.has(surfaceAt(this.session.track, x, z));
      this.skid.mark(car.id * 4 + w, x, z, on, car.y);
    }
  }
}

/** Number of start lights lit at tick t for a countdown ending at startTick. */
export function lightsOn(t: number, startTick: number): number {
  const first = startTick - 180;
  if (t < first) return 0;
  return Math.min(5, 1 + Math.floor((t - first) / 36));
}
