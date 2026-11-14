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
import { CrateView } from '../render/crateView.ts';
import { SkidMarks } from '../render/skidmarks.ts';
import { WeatherView } from '../render/weather.ts';
import { themeOf } from '../render/theme.ts';
import { drawText } from '../ui/font.ts';
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
  private readonly crates: CrateView;
  readonly effects: Effects;
  /** Rain or snow, spray and the wet road. */
  readonly weather: WeatherView;
  private readonly prev: Pose[] = [];
  /** Visual offset left over from network corrections; decays to zero. */
  private readonly offset: Pose[] = [];
  private readonly group = new THREE.Group();
  private readonly scene: THREE.Scene;
  private readonly lamps: THREE.MeshBasicMaterial[] = [];
  /** "This is you": a bouncing label and a pulsing ring over each local player's car. */
  private readonly markers: { car: number; label: THREE.Sprite; ring: THREE.Mesh }[] = [];
  /** Off on the title screen, where the "player" car is just a demo. */
  markPlayers = true;

  constructor(scene: THREE.Scene, session: GameSession, lightsOn: boolean, headlight: number) {
    this.scene = scene;
    this.session = session;
    this.effects = new Effects(this.particles, session.track);
    this.crates = new CrateView(session.track);
    this.weather = new WeatherView(session.world, !!themeOf(session.track.def.theme).snow);
    for (const car of session.world.cars) {
      const model = session.models[car.id] ?? -1;
      const view = new CarView(session.colors[car.id], car.id + 1, model >= 0 ? MODEL_STYLE[model] : undefined, session.league, session.looks?.[car.id]);
      view.setLights(lightsOn, headlight);
      this.cars.push(view);
      this.group.add(view.root);
      this.prev.push({ x: car.x, z: car.z, y: car.y, heading: car.heading });
      this.offset.push({ x: 0, z: 0, y: 0, heading: 0 });
    }
    this.group.add(this.skid.mesh, this.particles.points, this.shots.group, this.crates.group, this.weather.object);
    session.playerCars.forEach((car, p) => {
      const text = session.playerCars.length > 1 ? `P${p + 1}` : 'YOU';
      // P1 yellow, P2 cyan (like their HUD labels).
      const hex = p === 1 ? '#6fe0ff' : '#ffd84a';
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(text, hex), depthTest: false, depthWrite: false, transparent: true }));
      label.scale.set(5.6, 4.2, 1);
      label.renderOrder = 10;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.7, 3.3, 28).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(3), transparent: true, depthWrite: false }),
      );
      ring.renderOrder = 3;
      label.visible = ring.visible = false;
      this.group.add(label, ring);
      this.markers.push({ car, label, ring });
    });
    scene.add(this.group);
    const gantry = scene.getObjectByName('gantry');
    for (let k = 0; k < 5; k++) {
      const lamp = gantry?.getObjectByName(`startLamp${k}`) as THREE.Mesh | undefined;
      if (lamp) this.lamps.push(lamp.material as THREE.MeshBasicMaterial);
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.weather.dispose();
    for (const m of this.lamps) m.color.set('#3a0d0d');
  }

  /** Hide or show the whole race (cars, marks, particles) while something else is on stage. */
  show(on: boolean): void {
    this.group.visible = on;
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
    this.weather.tick(this.particles);
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
    // Corrections fade out over ~0.1-0.2 s; your own car glides more gently
    // (~0.3 s), so a shaky connection reads as a nudge rather than a jump.
    const fade = Math.exp(-dt * 12);
    const fadeOwn = Math.exp(-dt * 5);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      const p = this.prev[i];
      const o = this.offset[i];
      const k = this.session.playerCars.includes(i) ? fadeOwn : fade;
      o.x *= k;
      o.z *= k;
      o.heading *= k;
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
    this.crates.update(world, (world.tick + alpha) * DT);
    this.particles.time.value = (world.tick + alpha) * DT;
    this.particles.pxScale.value = pxScale;
    this.particles.dither.value = particleDither ? 1 : 0;
    this.weather.update(alpha, pxScale, this.particles.density, this.particles.light.value);
    this.particles.flush();
    this.updateStartLights();
    this.updateMarkers();
  }

  /** Show which car is yours: through the countdown, the first seconds of the race and after a respawn. */
  private updateMarkers(): void {
    const world = this.session.world;
    const race = world.race;
    const t = world.tick * DT;
    for (const m of this.markers) {
      const car = world.cars[m.car];
      const show = this.markPlayers && !car.finished && (
        race.phase === RacePhase.Countdown || (race.phase === RacePhase.Racing && world.tick < race.startTick + 240) || car.ghostTicks > 0
      );
      m.label.visible = m.ring.visible = show;
      if (!show) continue;
      const pos = this.cars[m.car].root.position;
      m.label.position.set(pos.x, pos.y + 5 + Math.abs(Math.sin(t * 5)) * 0.9, pos.z);
      const pulse = (t * 1.6) % 1;
      m.ring.position.set(pos.x, pos.y + 0.09, pos.z);
      m.ring.scale.setScalar(0.75 + pulse * 0.5);
      (m.ring.material as THREE.MeshBasicMaterial).opacity = 1 - pulse;
    }
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

/** A label with a down arrow, yellow on a dark outline. */
function markerTexture(text: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 30;
  const ctx = c.getContext('2d')!;
  drawText(ctx, text, 20, 2, { scale: 2, color, align: 'center' });
  // Arrow pointing down at the car, with a dark rim.
  for (const [col, grow] of [['#1a1408', 1], [color, 0]] as const) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(12 - grow, 19 - grow);
    ctx.lineTo(28 + grow, 19 - grow);
    ctx.lineTo(20, 28 + grow);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
