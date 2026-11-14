// Weapons and damage: front missiles, rear mines, turbo boosts, damage from
// knocks and hits, wrecks. Everything lives in the world state and uses no
// randomness, so the server and predicting clients agree.

import type { CarTuning } from '../config/tuning.ts';
import { wrapAngle } from '../math/angle.ts';
import { closestOnSegment, segmentsIntersect, type Closest } from '../math/geom.ts';
import type { Track, Walls } from '../track/types.ts';
import type { CarState } from './car.ts';
import { Ev, pushEvent, type EventBuffer } from './events.ts';
import { Btn, type CarInput } from './input.ts';
import { inPitArea } from '../track/pit.ts';
import { stepDriftBoost } from './driftBoost.ts';
import { knockFactor, shieldBlocks, steerHoming, SPECIAL } from './specials.ts';
import { DMath } from '../math/dmath.ts';

/** Homing missiles and oil slicks are the special items (specials.ts). */
export const ShotKind = { None: 0, Missile: 1, Mine: 2, Homing: 3, Oil: 4 } as const;

/** What each car starts a race with when weapons are on (crates on the track give more). */
export const START_AMMO = { missiles: 3, mines: 2, turbos: 2 };

export const WEAPON = {
  /** No shooting for this long after the start (the grid is too crowded). */
  startGrace: 180,
  missileSpeed: 52,
  /** Missiles are also carried forward by the car's own speed (up to this much). */
  missileInherit: 30,
  missileLife: 150,
  missileRadius: 0.5,
  missileDamage: 0.2,
  missileCool: 24,
  mineArm: 30,
  mineLife: 60 * 45,
  mineRadius: 0.7,
  mineDamage: 0.16,
  mineCool: 30,
  mineLaunch: 7,
  turboTicks: 90,
  turboAccel: 16,
  turboTopFactor: 1.3,
  /** Damage per m/s of impact above the tuning's damage speed. */
  wallDamage: 0.0055,
  carDamage: 0.004,
  wreckTicks: 150,
  /** Damage a car comes back with after being wrecked (patched, not repaired). */
  wreckRepair: 0.6,
  /** Damage mended per second of drifting (style pays a little). */
  driftRepair: 0.02,
};

export const MAX_SHOTS = 64;

export interface Shot {
  kind: number;
  owner: number;
  x: number;
  z: number;
  /** Height it flies (or lies) at: bridges keep levels apart. */
  y: number;
  vx: number;
  vz: number;
  heading: number;
  age: number;
  /** Homing missile: the car it is locked onto (-1 = none, flies straight). */
  target: number;
}

export function makeShot(): Shot {
  return { kind: 0, owner: 0, x: 0, z: 0, y: 0, vx: 0, vz: 0, heading: 0, age: 0, target: -1 };
}

const closest: Closest = { x: 0, z: 0, t: 0, d2: 0 };
const queryBuf = new Int32Array(128);

export function giveStartAmmo(car: CarState, on: boolean): void {
  car.missiles = on ? START_AMMO.missiles : 0;
  car.mines = on ? START_AMMO.mines : 0;
  car.turbos = on ? START_AMMO.turbos : 0;
}

/** True while the car can neither drive nor be hit. */
export function isWrecked(car: CarState): boolean {
  return car.wreckTicks > 0;
}

/** A free slot, or the oldest mine when the pool is full. */
export function allocShot(shots: Shot[]): Shot {
  for (const s of shots) if (s.kind === ShotKind.None) return s;
  if (shots.length < MAX_SHOTS) {
    const s = makeShot();
    shots.push(s);
    return s;
  }
  let oldest = shots[0];
  for (const s of shots) if (s.age > oldest.age) oldest = s;
  return oldest;
}

/** Fire / drop / boost on button presses. Called before the car's dynamics. */
export function useWeapons(car: CarState, inp: CarInput, shots: Shot[], ev: EventBuffer, allowed = true): void {
  if (car.fireCool > 0) car.fireCool--;
  if (car.mineCool > 0) car.mineCool--;
  // Not allowed: in the pit lane, where nobody shoots or gets shot.
  if (!allowed || car.finished || car.wreckTicks > 0 || car.ghostTicks > 0) return;
  const pressed = inp.buttons & ~car.prevButtons;
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  if (pressed & Btn.FireFront && car.missiles > 0 && car.fireCool === 0) {
    car.missiles--;
    car.fireCool = WEAPON.missileCool;
    const fwd = Math.max(0, Math.min(WEAPON.missileInherit, car.vx * fx + car.vz * fz));
    const s = allocShot(shots);
    s.kind = ShotKind.Missile;
    s.owner = car.id;
    s.x = car.x + fx * 2.7;
    s.z = car.z + fz * 2.7;
    s.y = car.y;
    s.vx = fx * (WEAPON.missileSpeed + fwd);
    s.vz = fz * (WEAPON.missileSpeed + fwd);
    s.heading = car.heading;
    s.age = 0;
    s.target = -1;
    pushEvent(ev, Ev.Fire, car.id, ShotKind.Missile, 0, s.x, s.z);
  }
  if (pressed & Btn.FireRear && car.mines > 0 && car.mineCool === 0) {
    car.mines--;
    car.mineCool = WEAPON.mineCool;
    const s = allocShot(shots);
    s.kind = ShotKind.Mine;
    s.owner = car.id;
    s.x = car.x - fx * 3.5;
    s.z = car.z - fz * 3.5;
    s.y = car.y;
    s.vx = s.vz = 0;
    s.heading = car.heading;
    s.age = 0;
    s.target = -1;
    pushEvent(ev, Ev.Fire, car.id, ShotKind.Mine, 0, s.x, s.z);
  }
  if (pressed & Btn.Turbo && car.turbos > 0 && car.turboTicks === 0) {
    car.turbos--;
    car.turboTicks = WEAPON.turboTicks;
    pushEvent(ev, Ev.Turbo, car.id, -1, 0, car.x, car.z);
  }
}

/** Turbo thrust and flight after a mine blast. Called after the car's dynamics. */
export function stepBoostAndAir(
  car: CarState, t: CarTuning, dt: number, ev: EventBuffer, damage: boolean, ground = 0, groundVy = 0,
): void {
  if (car.turboTicks > 0) {
    car.turboTicks--;
    if (car.spinTicks === 0 && car.wreckTicks === 0) {
      const fx = DMath.sin(car.heading);
      const fz = -DMath.cos(car.heading);
      const fwd = car.vx * fx + car.vz * fz;
      const top = t.vTop * WEAPON.turboTopFactor;
      if (fwd < top) {
        const a = WEAPON.turboAccel * Math.max(0, 1 - DMath.sq(fwd / top));
        car.vx += fx * a * dt;
        car.vz += fz * a * dt;
      }
    }
  }
  stepDriftBoost(car, t, dt);
  if (car.airborne) {
    car.vy -= t.gravity * dt;
    car.y += car.vy * dt;
    if (car.y <= ground) {
      // Landing on a slope going down is softer.
      const impact = groundVy - car.vy;
      car.y = ground;
      car.vy = groundVy;
      car.airborne = 0;
      // Coming down straight, nose the way you fly, is what jumps are for:
      // just a little speed lost. A crooked or backwards landing hurts and
      // costs a lot more.
      if (impact > 4) {
        pushEvent(ev, Ev.Land, car.id, -1, impact, car.x, car.z);
        const crooked = landingCrooked(car);
        if (damage && crooked > 0) car.damage = Math.min(1, car.damage + crooked * Math.max(0, impact - 6) * 0.012 * t.armour);
        const k = 1 - (0.02 + crooked * 0.12) * Math.min(1, impact / 15);
        car.vx *= k;
        car.vz *= k;
      }
    }
  }
}

/** 0 when a car lands pointing the way it flies, 1 when sideways or backwards. */
export function landingCrooked(car: CarState): number {
  const s = DMath.hypot(car.vx, car.vz);
  if (s < 3) return 0;
  const along = (car.vx * DMath.sin(car.heading) - car.vz * DMath.cos(car.heading)) / s;
  if (along <= 0) return 1;
  const angle = DMath.acos(Math.min(1, along));
  const lo = (25 * Math.PI) / 180;
  const hi = (70 * Math.PI) / 180;
  const x = Math.max(0, Math.min(1, (angle - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}

/** A hit: damage, a spin and a shove in the given direction. False when a shield took it. */
function hitCar(
  car: CarState, cars: CarState[], t: CarTuning, damage: number, dx: number, dz: number, ev: EventBuffer, kind: number, owner: number,
): boolean {
  if (shieldBlocks(car, dx, dz, ev, kind, owner)) return false;
  car.damage = Math.min(1, car.damage + damage * t.armour);
  if (owner !== car.id && cars[owner]) {
    cars[owner].hits++;
    car.lastHitBy = owner;
  }
  const keep = 0.45;
  car.vx = car.vx * keep + dx * 6;
  car.vz = car.vz * keep + dz * 6;
  car.spinTicks = t.spinTicks;
  car.spinCool = 0;
  car.angVel = (car.angVel >= 0 ? 1 : -1) * Math.max(Math.abs(car.angVel), t.spinYawKick * 1.4);
  car.sliding = 1;
  car.turboTicks = 0;
  pushEvent(ev, Ev.Explosion, car.id, owner, kind, car.x, car.z);
  return true;
}

function wallBetween(walls: Walls, ax: number, az: number, bx: number, bz: number, y: number): boolean {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const r = DMath.hypot(bx - ax, bz - az) / 2 + 0.6;
  const n = walls.grid.query(mx, mz, r, queryBuf);
  for (let q = 0; q < n; q++) {
    const i = queryBuf[q];
    if (y < walls.lo[i] - 0.3 || y > walls.hi[i]) continue;
    if (segmentsIntersect(ax, az, bx, bz, walls.ax[i], walls.az[i], walls.bx[i], walls.bz[i])) return true;
    closestOnSegment(bx, bz, walls.ax[i], walls.az[i], walls.bx[i], walls.bz[i], closest);
    if (closest.d2 < 0.16) return true;
  }
  return false;
}

/** Fly missiles, age mines, and blow up whatever they hit. */
export function stepShots(shots: Shot[], cars: CarState[], track: Track, tunings: readonly CarTuning[], dt: number, ev: EventBuffer): void {
  for (const s of shots) {
    if (s.kind === ShotKind.None) continue;
    s.age++;
    if (s.kind === ShotKind.Missile || s.kind === ShotKind.Homing) {
      const homing = s.kind === ShotKind.Homing;
      if (homing) steerHoming(s, cars, dt);
      const nx = s.x + s.vx * dt;
      const nz = s.z + s.vz * dt;
      if (s.age > (homing ? SPECIAL.homingLife : WEAPON.missileLife) || wallBetween(track.walls, s.x, s.z, nx, nz, s.y)) {
        pushEvent(ev, Ev.Explosion, -1, s.owner, 3, nx, nz);
        s.kind = ShotKind.None;
        continue;
      }
      // Swept test against both circles of every car along this tick's path.
      let hit = -1;
      for (const c of cars) {
        if ((c.id === s.owner && s.age < 20) || c.ghostTicks > 0 || c.wreckTicks > 0 || c.finished || Math.abs(c.y - s.y) > 1.2) continue;
        if (inPitArea(track.pit, c.x, c.z)) continue;
        const t = tunings[c.id] ?? tunings[0];
        const fx = DMath.sin(c.heading);
        const fz = -DMath.cos(c.heading);
        const rr = t.circleR + WEAPON.missileRadius;
        for (const off of [t.circleOffset, -t.circleOffset]) {
          closestOnSegment(c.x + fx * off, c.z + fz * off, s.x, s.z, nx, nz, closest);
          if (closest.d2 < rr * rr) hit = c.id;
        }
        if (hit >= 0) break;
      }
      s.x = nx;
      s.z = nz;
      if (hit >= 0) {
        const sp = DMath.hypot(s.vx, s.vz) || 1;
        const c = cars[hit];
        // value 4: a homing missile (the same damage and spin).
        hitCar(c, cars, tunings[hit] ?? tunings[0], WEAPON.missileDamage, s.vx / sp, s.vz / sp, ev, homing ? 4 : 1, s.owner);
        s.kind = ShotKind.None;
      }
    } else if (s.kind === ShotKind.Mine) {
      if (s.age > WEAPON.mineLife) {
        s.kind = ShotKind.None;
        continue;
      }
      if (s.age < WEAPON.mineArm) continue;
      for (const c of cars) {
        if (c.ghostTicks > 0 || c.wreckTicks > 0 || c.finished || Math.abs(c.y - s.y) > 0.5) continue;
        if (inPitArea(track.pit, c.x, c.z)) continue;
        const t = tunings[c.id] ?? tunings[0];
        const fx = DMath.sin(c.heading);
        const fz = -DMath.cos(c.heading);
        const rr = t.circleR + WEAPON.mineRadius;
        let near = false;
        for (const off of [t.circleOffset, -t.circleOffset]) {
          const dx = c.x + fx * off - s.x;
          const dz = c.z + fz * off - s.z;
          if (dx * dx + dz * dz < rr * rr) near = true;
        }
        if (!near) continue;
        if (hitCar(c, cars, t, WEAPON.mineDamage, 0, 0, ev, 2, s.owner)) {
          c.vy = WEAPON.mineLaunch;
          c.y += 0.01;
          c.airborne = 1;
        }
        s.kind = ShotKind.None;
        break;
      }
    } else if (s.kind === ShotKind.Oil) {
      // An oil slick: it works through the surface under the cars (specials.ts slickUnder).
      if (s.age > SPECIAL.oilLife) s.kind = ShotKind.None;
    }
  }
}

/** Damage from this tick's knocks (wall and car hits in the event buffer). */
export function applyImpactDamage(cars: CarState[], tunings: readonly CarTuning[], ev: EventBuffer, from: number): void {
  for (let k = from; k < ev.count; k++) {
    const e = ev.list[k];
    if (e.kind === Ev.WallHit) {
      const c = cars[e.car];
      const t = tunings[c.id] ?? tunings[0];
      if (!c.finished && e.value > t.wallDamageSpeed) c.damage = Math.min(1, c.damage + (e.value - t.wallDamageSpeed) * WEAPON.wallDamage * t.armour * knockFactor(c));
    } else if (e.kind === Ev.CarHit) {
      for (const id of [e.car, e.other]) {
        const c = cars[id];
        const t = tunings[c.id] ?? tunings[0];
        if (!c.finished && e.value > t.carDamageSpeed) c.damage = Math.min(1, c.damage + (e.value - t.carDamageSpeed) * WEAPON.carDamage * t.armour * knockFactor(c));
      }
    }
  }
}

/** Fully damaged cars blow up and sit out a moment. Returns true when one did. */
export function checkWreck(car: CarState, cars: CarState[], ev: EventBuffer): boolean {
  if (car.damage < 1 || car.wreckTicks > 0 || car.finished) return false;
  car.wreckTicks = WEAPON.wreckTicks;
  car.wrecks++;
  car.turboTicks = 0;
  car.shieldTicks = 0;
  const by = car.lastHitBy;
  if (by >= 0 && cars[by]) cars[by].kills++;
  car.lastHitBy = -1;
  pushEvent(ev, Ev.Wreck, car.id, by, 0, car.x, car.z);
  return true;
}

/** A wrecked car: slides to a stop, no control. */
export function stepWreck(car: CarState, dt: number): void {
  const s = DMath.hypot(car.vx, car.vz);
  if (s > 0) {
    const k = Math.max(0, s - 14 * dt) / s;
    car.vx *= k;
    car.vz *= k;
  }
  car.angVel *= DMath.exp(-3 * dt);
  car.heading = wrapAngle(car.heading + car.angVel * dt);
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  car.slip = 0;
  car.latAccel = 0;
  car.longAccel = 0;
}
