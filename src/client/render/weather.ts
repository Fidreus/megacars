// Weather you see: rain (or snow on a winter track) falling around the
// camera, spray behind the cars on a wet road, a wet sheen on the road, and
// a greyer light. How hard it rains follows the race's weather plan, so in a
// changing race the rain is seen coming before the road gets slippery.
// Cosmetic only: it may use Math.random.

import * as THREE from 'three';
import { DT } from '../../shared/config/constants.ts';
import { Surface } from '../../shared/config/surfaces.ts';
import type { World } from '../../shared/sim/world.ts';
import { rainAt, wetnessAt } from '../../shared/sim/weather.ts';
import type { GradeSettings } from './post/passes.ts';
import type { Mood } from './mood.ts';
import type { Particles } from './particles.ts';

/** Drops at the highest graphics level; lower levels draw a share of them (Particles.density). */
const RAIN_DROPS = 2600;
const SNOW_FLAKES = 1500;
/** Height of the box of falling drops around the view (m). */
const FALL_H = 26;

/** Shared with the road shader (trackMesh.ts): how wet it looks, and what the puddles reflect. */
export const roadWeather = {
  uWet: { value: 0 },
  uSheen: { value: new THREE.Color(0.6, 0.65, 0.72) },
  /** 1 on a snowy track: slush instead of puddles. */
  uSlush: { value: 0 },
};

const VERT = /* glsl */ `
attribute vec2 aDrop;   // speed jitter, streak end (0 head, 1 tail)
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uFall;
uniform float uStreak;
uniform float uSnow;
uniform float uPx;
varying float vTail;
void main() {
  vec3 v = uFall * (0.8 + 0.4 * aDrop.x);
  vec3 p = position * uBox + v * uTime;
  // Snow drifts from side to side.
  p.x += uSnow * sin(uTime * 1.3 + position.z * 37.0) * 0.9;
  p.z += uSnow * cos(uTime * 1.1 + position.x * 41.0) * 0.9;
  vec2 lo = uCenter.xz - uBox.xz * 0.5;
  p.xz = lo + mod(p.xz - lo, uBox.xz);
  p.y = uCenter.y + mod(p.y, uBox.y);
  p -= v * uStreak * aDrop.y;
  vTail = aDrop.y;
  gl_PointSize = max(1.0, 2.0 * uPx);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uLight;
varying float vTail;
void main() {
  gl_FragColor = vec4(uColor * uLight, 0.75 - 0.45 * vTail);
}
`;

/** Rain or snow falling round each viewport's camera. */
export class WeatherView {
  readonly object: THREE.LineSegments | THREE.Points;
  /** How hard it rains now, 0..1 (sound, light, HUD). */
  rain = 0;
  /** How wet the road is now, 0..1. */
  wet = 0;
  readonly snow: boolean;
  private readonly world: World;
  private readonly count: number;
  private readonly uniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: new THREE.Vector3(100, FALL_H, 100) },
    uFall: { value: new THREE.Vector3() },
    uStreak: { value: 0 },
    uSnow: { value: 0 },
    uPx: { value: 1 },
    uColor: { value: new THREE.Color() },
    uLight: { value: 1 },
  };

  constructor(world: World, snow: boolean) {
    this.world = world;
    this.snow = snow;
    const n = snow ? SNOW_FLAKES : RAIN_DROPS;
    this.count = n;
    const verts = snow ? n : n * 2;
    const pos = new Float32Array(verts * 3);
    const drop = new Float32Array(verts * 2);
    for (let i = 0; i < n; i++) {
      // Spread evenly, so any leading share of them covers the view.
      const x = Math.random();
      const y = Math.random();
      const z = Math.random();
      const j = Math.random();
      for (let e = 0; e < (snow ? 1 : 2); e++) {
        const v = snow ? i : i * 2 + e;
        pos.set([x, y, z], v * 3);
        drop.set([j, e], v * 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDrop', new THREE.BufferAttribute(drop, 2));
    const u = this.uniforms;
    if (snow) {
      u.uFall.value.set(0.7, -2.4, 0.5);
      u.uSnow.value = 1;
      u.uColor.value.setRGB(0.95, 0.97, 1.0);
    } else {
      u.uFall.value.set(2.2, -17, 3);
      u.uStreak.value = 0.085;
      u.uColor.value.setRGB(0.72, 0.78, 0.88);
    }
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthWrite: false });
    this.object = snow ? new THREE.Points(geo, mat) : new THREE.LineSegments(geo, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 4;
    this.object.name = 'weather';
    this.object.visible = false;
    // Each viewport: centre the box of drops on the ground the camera looks at.
    const dir = new THREE.Vector3();
    this.object.onBeforeRender = (_r, _s, camera) => {
      const cam = camera as THREE.OrthographicCamera;
      cam.getWorldDirection(dir);
      const t = dir.y < -0.05 ? cam.position.y / -dir.y : 0;
      u.uCenter.value.set(cam.position.x + dir.x * t, 0, cam.position.z + dir.z * t);
      const w = cam.right - cam.left;
      const h = cam.top - cam.bottom;
      const side = Math.hypot(w, h / Math.max(0.3, -dir.y)) + FALL_H + 8;
      u.uBox.value.set(side, FALL_H, side);
    };
  }

  /** After each simulation step: spray off the tyres on a wet road. */
  tick(particles: Particles): void {
    const world = this.world;
    const R = Math.random;
    const wet = wetnessAt(world.weather, world.tick);
    for (const car of world.cars) {
      if (car.airborne || car.wreckTicks > 0) continue;
      const surf = car.surfRear;
      // Manhattan's soaked patches spray in any weather.
      const w = surf === Surface.Wet ? 1 : surf === Surface.Asphalt || surf === Surface.Curb ? wet : 0;
      const s = Math.hypot(car.vx, car.vz);
      if (w < 0.1 || s < 9) continue;
      const k = w * Math.min(1, (s - 9) / 30);
      const fx = Math.sin(car.heading);
      const fz = -Math.cos(car.heading);
      const rx = Math.cos(car.heading);
      const rz = Math.sin(car.heading);
      for (const side of [-0.9, 0.9]) {
        if (R() > k * 0.9) continue;
        const g = this.snow ? 0.88 + R() * 0.1 : 0.7 + R() * 0.12;
        particles.spawn(
          car.x + rx * side - fx * 2.1 + (R() - 0.5) * 0.6, car.y + 0.3, car.z + rz * side - fz * 2.1 + (R() - 0.5) * 0.6,
          car.vx * 0.35 - fx * 2 + rx * side * 1.5 + (R() - 0.5) * 2, 1.2 + R() * 1.8, car.vz * 0.35 - fz * 2 + rz * side * 1.5 + (R() - 0.5) * 2,
          0.3 + R() * 0.3, 2.5, 8 + R() * 5, g, g * 1.02, g * 1.08, -5, 2.4,
        );
      }
    }
  }

  /** Every frame. `density` is the graphics level's share of particles. */
  update(alpha: number, pxScale: number, density: number, light: number): void {
    const world = this.world;
    const t = world.tick + alpha;
    this.rain = rainAt(world.weather, t);
    this.wet = wetnessAt(world.weather, t);
    const u = this.uniforms;
    u.uTime.value = t * DT;
    u.uPx.value = pxScale;
    u.uLight.value = this.snow ? Math.max(0.55, light) : Math.max(0.35, light);
    const n = Math.round(this.count * density * this.rain);
    this.object.visible = n > 0;
    this.object.geometry.setDrawRange(0, this.snow ? n : n * 2);
    roadWeather.uWet.value = this.wet;
    roadWeather.uSlush.value = this.snow ? 1 : 0;
  }

  dispose(): void {
    this.object.geometry.dispose();
    (this.object.material as THREE.Material).dispose();
    roadWeather.uWet.value = 0;
  }
}

const GREY_SKY = new THREE.Color('#8c96a4');
const SNOW_SKY = new THREE.Color('#c8d2de');
const RAIN_TINT = new THREE.Color(0.9, 0.95, 1.05);
const SNOW_TINT = new THREE.Color(0.95, 0.98, 1.05);
const tmp = new THREE.Color();

interface Lights {
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  grade: GradeSettings;
  scene: THREE.Scene;
}

/**
 * Darker, greyer light while it rains, blended over the time of day, and
 * now and then a lightning flash. Applies on top of setMood every frame
 * while there is any rain (and once more when it has gone).
 */
export class WeatherLight {
  private applied = false;
  private flash = 0;
  private nextBolt = 8 + Math.random() * 12;
  /** Seconds until the thunder of the last flash (negative = none due). */
  private thunderIn = -1;
  private thunderSize = 0;
  /** A thunderclap to play now (0..1 strength; the sound resets it). */
  thunder = 0;

  update(mood: Mood, rain: number, snow: boolean, dt: number, l: Lights): void {
    if (rain <= 0 && !this.applied) return;
    this.applied = rain > 0;
    const k = rain * (snow ? 0.55 : 1);
    // Lightning: heavy rain only (never in snow).
    if (!snow && rain > 0.8) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 12 + Math.random() * 25;
        this.thunderSize = 0.4 + Math.random() * 0.6;
        this.flash = 0.25 * this.thunderSize + 0.1;
        // Further away: dimmer flash, later thunder.
        this.thunderIn = 0.3 + (1 - this.thunderSize) * 2.5;
      }
    }
    if (this.thunderIn >= 0) {
      this.thunderIn -= dt;
      if (this.thunderIn < 0) this.thunder = this.thunderSize;
    }
    this.flash = Math.max(0, this.flash - dt);
    const bolt = this.flash > 0 && Math.floor(this.flash * 30) % 3 !== 1 ? Math.min(1, this.flash * 5) : 0;

    l.sun.intensity = mood.sunIntensity * (1 - 0.68 * k) + bolt * 2.5;
    l.sun.color.set(mood.sunColor).lerp(snow ? SNOW_SKY : GREY_SKY, 0.5 * k);
    l.hemi.intensity = mood.hemiIntensity * (1 - 0.12 * k) + bolt * 1.5;
    l.hemi.color.set(mood.skyColor).lerp(snow ? SNOW_SKY : GREY_SKY, 0.6 * k);
    const g = l.grade;
    g.saturation = mood.saturation * (1 - (snow ? 0.18 : 0.3) * k);
    g.exposure = mood.exposure * (1 - (snow ? 0.02 : 0.1) * k) + bolt * 0.25;
    g.tint.copy(mood.tint).lerp(tmp.copy(mood.tint).multiply(snow ? SNOW_TINT : RAIN_TINT), k);
    g.lift.copy(mood.lift).lerp(tmp.setRGB(0.012, 0.014, 0.02), 0.6 * k);
    if (l.scene.background instanceof THREE.Color) l.scene.background.set(mood.background).lerp(tmp.copy(GREY_SKY).multiplyScalar(mood.hemiIntensity * 0.4), 0.5 * k);
    // What the puddles reflect: the sky, greyed.
    roadWeather.uSheen.value.set(mood.skyColor).lerp(snow ? SNOW_SKY : GREY_SKY, 0.5).multiplyScalar(mood.lights ? 0.6 : 1);
  }
}
