// Car state and the arcade drift model.
//
// The tyres never apply forces directly. Each tick they turn the velocity
// vector toward the direction the nose points, limited by a lateral
// acceleration budget. While gripping the budget is aGrip and costs no speed.
// While sliding the budget is larger (aSlide, the arcade "drift bonus") but the
// turn rate grows with the slip angle β and the car scrubs speed ∝ |sin β|.
// Full lock at high speed asks for more than aGrip, so the car breaks loose:
// that is how corners are taken flat out.

import { DEG, approach, clamp, headingOf, lerp, smoothstep, wrapAngle } from '../math/angle.ts';
import type { CarTuning } from '../config/tuning.ts';
import type { SurfaceMix } from '../config/surfaces.ts';
import { Btn, type CarInput } from './input.ts';

export interface CarState {
  id: number;
  // Body
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  heading: number;
  angVel: number;
  steer: number;
  // Handling state
  sliding: number;
  /** Grip: ticks the tyres have been overloaded. Slide: ticks with small slip. */
  modeTicks: number;
  spinTicks: number;
  spinCool: number;
  airborne: number;
  // Condition
  damage: number;
  // Control
  prevButtons: number;
  aiDriven: number;
  aiMode: number;
  aiSkill: number;
  // Race progress
  trackIdx: number;
  trackS: number;
  raceDist: number;
  lap: number;
  nextCp: number;
  lapStartTick: number;
  lastLapTicks: number;
  bestLapTicks: number;
  wrongWayTicks: number;
  finished: number;
  // Derived each tick (recomputed, never authoritative)
  slip: number;
  latAccel: number;
  longAccel: number;
  surfFront: number;
  surfRear: number;
}

export function createCar(id: number, x: number, z: number, heading: number): CarState {
  return {
    id, x, z, y: 0, vx: 0, vz: 0, vy: 0, heading, angVel: 0, steer: 0,
    sliding: 0, modeTicks: 0, spinTicks: 0, spinCool: 0, airborne: 0,
    damage: 0,
    prevButtons: 0, aiDriven: 0, aiMode: 1, aiSkill: 1,
    trackIdx: 0, trackS: 0, raceDist: 0, lap: 0, nextCp: 0,
    lapStartTick: 0, lastLapTicks: 0, bestLapTicks: 0, wrongWayTicks: 0, finished: 0,
    slip: 0, latAccel: 0, longAccel: 0, surfFront: 0, surfRear: 0,
  };
}

export function carSpeed(c: CarState): number {
  return Math.hypot(c.vx, c.vz);
}

/** Engine and top-speed multiplier from accumulated damage (0..1). */
export function damagePerformance(damage: number): number {
  return damage <= 0.4 ? 1 : 1 - 0.3 * Math.min(1, (damage - 0.4) / 0.6);
}

export function stepCarDynamics(car: CarState, inp: CarInput, t: CarTuning, surf: SurfaceMix, dt: number): void {
  // Steering wheel: keyboards ramp, analog sticks are direct.
  const steerIn = clamp(inp.steer, -1, 1);
  if (inp.buttons & Btn.Analog) {
    car.steer = steerIn;
  } else {
    const flip = steerIn !== 0 && car.steer !== 0 && steerIn > 0 !== car.steer > 0;
    const rate = flip ? t.steerRateFlip : Math.abs(steerIn) > Math.abs(car.steer) ? t.steerRateIn : t.steerRateOut;
    car.steer = approach(car.steer, steerIn, rate * dt);
  }
  if (car.spinCool > 0) car.spinCool--;
  if (car.spinTicks > 0) {
    stepSpin(car, t, dt);
    return;
  }

  const throttle = clamp(inp.throttle, 0, 1);
  const brake = clamp(inp.brake, 0, 1);
  let fx = Math.sin(car.heading);
  let fz = -Math.cos(car.heading);
  let vx = car.vx;
  let vz = car.vz;
  const vF = vx * fx + vz * fz;

  // 1. Longitudinal: applied as a vector along the nose, so in a drift the
  //    throttle also bends the path (power slide).
  const perf = damagePerformance(car.damage);
  const vTop = t.vTop * surf.vTop * perf;
  const accel = t.accel0 * surf.accel * perf;
  let aLong = 0;
  let aEng = 0;
  let braking = 0;
  if (throttle > 0) {
    if (vF > -0.5) {
      const r = vF / vTop;
      aEng = throttle * accel * Math.max(0, 1 - r * r);
      aLong += aEng;
    } else {
      aLong += throttle * t.brakeDecel;
    }
  }
  if (brake > 0) {
    if (vF > 0.5) {
      aLong -= brake * t.brakeDecel;
      braking = brake;
    } else {
      const r = Math.max(0, -vF) / t.reverseMax;
      aLong -= brake * t.reverseAccel * Math.max(0, 1 - r * r);
    }
  }
  vx += fx * aLong * dt;
  vz += fz * aLong * dt;

  let s = Math.hypot(vx, vz);
  if (s > 0) {
    const resist = (1 - throttle) * (t.coastBase + t.coastLinear * s) + surf.drag + surf.dragLinear * s;
    const ns = Math.max(0, s - resist * dt);
    const k = ns / s;
    vx *= k;
    vz *= k;
    s = ns;
  }

  // 2. Yaw: steering sets a target yaw rate; rotation lags behind it, more so
  //    in a slide (that inertia is what counter-steering fights).
  const fwd = vx * fx + vz * fz;
  const dirSign = fwd >= 0 ? 1 : -1;
  let omegaMax: number;
  if (!car.sliding) {
    const aSteer = t.aGrip * lerp(t.steerLo, t.steerHi, smoothstep(t.steerV0, t.steerV1, s));
    omegaMax = Math.min(s / t.rMin, t.omegaPeak, aSteer / Math.max(s, 1));
  } else {
    omegaMax = Math.min(t.omegaPeak, t.aSteerSlide / Math.max(s, 5));
  }
  let omegaT = car.steer * omegaMax * dirSign;
  if (car.sliding) {
    const b = car.slip;
    const bs = b > 0 ? 1 : b < 0 ? -1 : 0;
    omegaT += bs * t.kPow * throttle * smoothstep(3 * DEG, 15 * DEG, Math.abs(b));
    omegaT -= (inp.buttons & Btn.Analog ? t.assistPad : t.assistKb) * b;
  }
  const kYaw = car.sliding ? t.kYawSlide : t.kYawGrip;
  car.angVel += (omegaT - car.angVel) * (1 - Math.exp(-kYaw * dt));
  car.heading = wrapAngle(car.heading + car.angVel * dt);

  // 3. Tyres: swing the velocity toward the nose within the budget.
  fx = Math.sin(car.heading);
  fz = -Math.cos(car.heading);
  const fwd2 = vx * fx + vz * fz;
  let latAccel = 0;
  if (s < 3) {
    vx = fx * fwd2;
    vz = fz * fwd2;
    car.sliding = 0;
    car.modeTicks = 0;
    car.slip = 0;
  } else {
    const dirHeading = fwd2 >= 0 ? car.heading : car.heading + Math.PI;
    const beta = wrapAngle(dirHeading - headingOf(vx, vz));
    let delta: number;
    if (!car.sliding) {
      // Friction circle: braking or hard acceleration eats lateral grip.
      const u = braking > 0 ? braking : (0.5 * aEng) / t.brakeDecel;
      const budget = t.aGrip * surf.grip * (1 - t.frictionCircle * u * u);
      const maxRot = (budget / s) * dt;
      delta = clamp(beta, -maxRot, maxRot);
      // Breaking loose: the yaw rate asks for more lateral grip than the tyres
      // can give for a few ticks in a row, or the slip got too big anyway.
      if (Math.abs(car.angVel) * s > budget * t.overloadRatio) car.modeTicks++;
      else car.modeTicks = 0;
      if (car.modeTicks >= t.slideEnterTicks || Math.abs(beta - delta) > t.slipEnterDeg * DEG) {
        car.sliding = 1;
        car.modeTicks = 0;
      }
    } else {
      const rate = Math.min(t.kAlign * Math.abs(beta), (t.aSlide * surf.slide) / s);
      delta = clamp(beta, -rate * dt, rate * dt);
      const scrub = Math.max(0, 1 - t.cScrub * surf.scrub * Math.abs(Math.sin(beta)) * dt);
      vx *= scrub;
      vz *= scrub;
      if (Math.abs(beta) < t.slipExitDeg * DEG) {
        if (++car.modeTicks >= t.slipExitTicks) {
          car.sliding = 0;
          car.modeTicks = 0;
        }
      } else {
        car.modeTicks = 0;
      }
      if (Math.abs(beta) > t.spinDeg * DEG && s > t.spinMinSpeed && car.spinCool === 0) startSpin(car, t, beta);
    }
    // Rotate velocity clockwise (toward increasing heading) by delta.
    const c = Math.cos(delta);
    const sn = Math.sin(delta);
    const nvx = vx * c - vz * sn;
    vz = vz * c + vx * sn;
    vx = nvx;
    car.slip = beta;
    latAccel = (delta / dt) * s;
  }

  car.vx = vx;
  car.vz = vz;
  car.latAccel = latAccel;
  car.longAccel = aLong;
  car.x += vx * dt;
  car.z += vz * dt;
}

function startSpin(car: CarState, t: CarTuning, beta: number): void {
  car.spinTicks = t.spinTicks;
  const dir = car.angVel !== 0 ? Math.sign(car.angVel) : Math.sign(beta) || 1;
  car.angVel = dir * Math.max(Math.abs(car.angVel), t.spinYawKick);
}

function stepSpin(car: CarState, t: CarTuning, dt: number): void {
  car.spinTicks--;
  const s = Math.hypot(car.vx, car.vz);
  if (s > 0) {
    const k = Math.max(0, s - t.spinDecel * dt) / s;
    car.vx *= k;
    car.vz *= k;
  }
  car.angVel *= Math.exp(-2.5 * dt);
  car.heading = wrapAngle(car.heading + car.angVel * dt);
  car.x += car.vx * dt;
  car.z += car.vz * dt;
  const sp = Math.hypot(car.vx, car.vz);
  car.slip = sp > 0.5 ? wrapAngle(car.heading - headingOf(car.vx, car.vz)) : 0;
  car.latAccel = 0;
  car.longAccel = -t.spinDecel;
  if (car.spinTicks === 0) {
    car.sliding = 1;
    car.modeTicks = 0;
    car.spinCool = t.spinCooldownTicks;
  }
}

/** After an external impulse, start sliding if the nose and velocity disagree. */
export function updateSlideAfterImpact(car: CarState, t: CarTuning): void {
  const s = Math.hypot(car.vx, car.vz);
  if (s < 3 || car.sliding) return;
  const fwd = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
  const dirHeading = fwd >= 0 ? car.heading : car.heading + Math.PI;
  const beta = wrapAngle(dirHeading - headingOf(car.vx, car.vz));
  if (Math.abs(beta) > t.slipEnterDeg * DEG) {
    car.sliding = 1;
    car.modeTicks = 0;
  }
}
