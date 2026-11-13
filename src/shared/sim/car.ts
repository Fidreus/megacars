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
  // Condition and weapons
  /** 0 = like new, 1 = wrecked. */
  damage: number;
  missiles: number;
  mines: number;
  turbos: number;
  /** Ticks left of a turbo boost. */
  turboTicks: number;
  fireCool: number;
  mineCool: number;
  /** Ticks left as a smoking wreck before coming back. */
  wreckTicks: number;
  /** Missile and mine hits landed on others, and wrecks caused (prize money). */
  hits: number;
  kills: number;
  /** Times wrecked this race (each one is a tow, charged in money modes). */
  wrecks: number;
  /** Ticks spent in the pit box without a break (each full second repairs). */
  pitTicks: number;
  /** Who hit this car last (-1 = nobody), credited if it is wrecked. */
  lastHitBy: number;
  /** Drift boost (driftBoost.ts): seconds of drift charged, ticks and level of a boost running. */
  driftCharge: number;
  driftBoostTicks: number;
  driftBoostLevel: number;
  /** Slipstream strength 0-1 (slipstream.ts). */
  draft: number;
  // Control
  prevButtons: number;
  /** Ticks the brake has been held (drift tap detection). */
  brakeTicks: number;
  /** Ticks the throttle has been released (lift-off flick detection); 0 while on the gas. */
  liftTicks: number;
  /** Ticks left in which steering turns a brake tap into a drift. */
  driftArm: number;
  aiDriven: number;
  aiMode: number;
  aiSkill: number;
  /** Ticks left of an AI reverse manoeuvre (getting unstuck). */
  aiReverseTicks: number;
  /** 1 for cars driven by people (race end, respawn rules). */
  human: number;
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
  finishTick: number;
  /** Current race position, 1-based (derived each tick). */
  place: number;
  /** Ticks spent (nearly) stopped while trying to move. */
  stuckTicks: number;
  /** Ticks left without car-to-car collisions (after a respawn). */
  ghostTicks: number;
  respawns: number;
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
    damage: 0, missiles: 0, mines: 0, turbos: 0, turboTicks: 0, fireCool: 0, mineCool: 0, wreckTicks: 0, hits: 0, kills: 0, wrecks: 0, pitTicks: 0, lastHitBy: -1,
    prevButtons: 0, brakeTicks: 0, liftTicks: 60, driftArm: 0, aiDriven: 0, aiMode: 1, aiSkill: 1, aiReverseTicks: 0, human: 0,
    trackIdx: 0, trackS: 0, raceDist: 0, lap: 0, nextCp: 0,
    lapStartTick: 0, lastLapTicks: 0, bestLapTicks: 0, wrongWayTicks: 0, finished: 0,
    finishTick: 0, place: id + 1, stuckTicks: 0, ghostTicks: 0, respawns: 0,
    slip: 0, latAccel: 0, longAccel: 0, surfFront: 0, surfRear: 0,
    driftCharge: 0, driftBoostTicks: 0, driftBoostLevel: 0, draft: 0,
  };
}

export function carSpeed(c: CarState): number {
  return Math.hypot(c.vx, c.vz);
}

/** How damage wears the car: nothing up to `from`, the full loss at 100 %. */
export const DAMAGE_WEAR = {
  from: 0.2,
  /** Engine and top speed lost. */
  engine: 0.18,
  /** Grip lost, gripping and sliding. */
  grip: 0.1,
};

/** Fold the car's damage into the surface it drives on (tuning.damageSlow 0 = no effect). */
export function applyDamage(surf: SurfaceMix, damage: number, t: CarTuning): void {
  const k = t.damageSlow * Math.max(0, Math.min(1, (damage - DAMAGE_WEAR.from) / (1 - DAMAGE_WEAR.from)));
  if (k <= 0) return;
  surf.accel *= 1 - DAMAGE_WEAR.engine * k;
  surf.vTop *= 1 - DAMAGE_WEAR.engine * k;
  surf.grip *= 1 - DAMAGE_WEAR.grip * k;
  surf.slide *= 1 - DAMAGE_WEAR.grip * k;
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
  const vTop = t.vTop * surf.vTop;
  const accel = t.accel0 * surf.accel;
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
  // Holding brake when (nearly) stopped or rolling back drives in reverse.
  let reversing = 0;
  if (brake > 0) {
    if (vF > 0.5) {
      aLong -= brake * t.brakeDecel;
      braking = brake;
    } else {
      const r = Math.max(0, -vF) / t.reverseMax;
      aLong -= brake * t.reverseAccel * Math.max(0, 1 - r * r);
      reversing = brake;
    }
  }
  vx += fx * aLong * dt;
  vz += fz * aLong * dt;

  let s = Math.hypot(vx, vz);
  if (s > 0) {
    // Engine braking only when coasting: driving forwards or in reverse is powered.
    const resist = (1 - Math.max(throttle, reversing)) * (t.coastBase + t.coastLinear * s) + surf.drag + surf.dragLinear * s;
    const ns = Math.max(0, s - resist * dt);
    const k = ns / s;
    vx *= k;
    vz *= k;
    s = ns;
  }

  // Grip budget for this tick: braking or hard acceleration eats lateral
  // grip (friction circle).
  const budget = gripBudget(t, surf, braking, aEng);
  const slippery = surf.slippery > 0;

  // 2. Drift trigger: a short brake tap while steering flicks the car into a slide.
  const fwd = vx * fx + vz * fz;
  updateDriftTrigger(car, inp, t, fwd);

  // 3. Yaw: steering sets a target yaw rate; rotation lags behind it, more so
  //    in a slide (that inertia is what counter-steering fights).
  const dirSign = fwd >= 0 ? 1 : -1;
  const omegaMax = car.sliding ? slideOmegaMax(t, s) : gripOmegaMax(t, s, budget, slippery);
  let omegaT = car.steer * omegaMax * dirSign;
  if (car.sliding) {
    const b = car.slip;
    const bs = b > 0 ? 1 : b < 0 ? -1 : 0;
    omegaT += powerOversteer(t, b, car.steer * dirSign, throttle);
    omegaT -= (inp.buttons & Btn.Analog ? t.assistPad : t.assistKb) * b;
  }
  const kYaw = car.sliding ? t.kYawSlide : t.kYawGrip;
  car.angVel += (omegaT - car.angVel) * (1 - Math.exp(-kYaw * dt));
  car.heading = wrapAngle(car.heading + car.angVel * dt);

  // 4. Tyres: swing the velocity toward the nose within the budget.
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
      const maxRot = (budget / s) * dt;
      delta = clamp(beta, -maxRot, maxRot);
      // On slippery ground steering alone can overload the tyres. On paved
      // ground only a big leftover slip (after a knock) breaks traction.
      if (slippery && Math.abs(car.angVel) * s > budget * t.overloadRatio) car.modeTicks++;
      else car.modeTicks = 0;
      const slipLimit = (slippery ? t.slipEnterDeg : t.slipEnterDegPaved) * DEG;
      if (car.modeTicks >= t.slideEnterTicks || Math.abs(beta - delta) > slipLimit) {
        car.sliding = 1;
        car.modeTicks = 0;
      }
    } else {
      // The more sideways the car is, the harder the tyres swing the velocity
      // round (and the more speed they scrub): big angle = tight turn.
      const aSlide = t.aSlide * (1 + t.slideAngleBoost * smoothstep(15 * DEG, 60 * DEG, Math.abs(beta)));
      const rate = Math.min(t.kAlign * Math.abs(beta), (aSlide * surf.slide) / s);
      delta = clamp(beta, -rate * dt, rate * dt);
      const scrub = Math.max(0, 1 - t.cScrub * surf.scrub * Math.abs(Math.sin(beta)) * dt);
      vx *= scrub;
      vz *= scrub;
      // Holding the drift button keeps the car sliding.
      if (Math.abs(beta) < t.slipExitDeg * DEG && !(inp.buttons & Btn.Drift)) {
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

/** Lateral acceleration the tyres can give while gripping, m/s². */
export function gripBudget(t: CarTuning, surf: SurfaceMix, braking: number, aEng: number): number {
  const u = braking > 0 ? braking : (0.5 * aEng) / t.brakeDecel;
  return t.aGrip * surf.grip * (1 - t.frictionCircle * u * u);
}

/**
 * Highest yaw rate steering asks for while gripping. On paved ground full lock
 * uses all the grip there is and no more, so the car understeers at the limit
 * instead of sliding by itself. On slippery ground the wheel asks for
 * asphalt-level grip and the car breaks loose.
 */
export function gripOmegaMax(t: CarTuning, s: number, budget: number, slippery: boolean): number {
  const aSteer = slippery ? t.aGrip * lerp(t.steerLo, t.steerHi, smoothstep(t.steerV0, t.steerV1, s)) : budget * t.steerGrip;
  return Math.min(s / t.rMin, t.omegaPeak, aSteer / Math.max(s, 1));
}

/**
 * Gas in a slide swings the tail further out (a power slide), at full
 * strength only while steering into the slide. With the wheel straight or
 * counter-steering just a little of it is left, so the car straightens up by
 * itself instead of circling on the throttle.
 */
export function powerOversteer(t: CarTuning, slip: number, steerYaw: number, throttle: number): number {
  const bs = slip > 0 ? 1 : slip < 0 ? -1 : 0;
  const into = Math.max(0, Math.min(1, steerYaw * bs));
  return bs * t.kPow * throttle * smoothstep(3 * DEG, 15 * DEG, Math.abs(slip)) * (t.kPowNeutral + (1 - t.kPowNeutral) * into);
}

export function slideOmegaMax(t: CarTuning, s: number): number {
  return Math.min(t.omegaPeak, t.aSteerSlide / Math.max(s, 5));
}

/**
 * Two ways to arm a drift: a short brake tap, or lifting off the throttle
 * briefly and getting back on it (lift-off flick). Steering at speed while
 * armed throws the car into a slide with a yaw flick. Holding the brake or
 * coasting for longer does nothing. While already sliding, a flick can swing
 * the car the other way (S-bends).
 */
function updateDriftTrigger(car: CarState, inp: CarInput, t: CarTuning, fwd: number): void {
  if (inp.buttons & Btn.Drift && !(car.prevButtons & Btn.Drift)) car.driftArm = t.driftArmTicks;
  if (inp.brake > 0.5) {
    car.brakeTicks++;
  } else {
    if (car.brakeTicks > 0 && car.brakeTicks <= t.driftTapTicks) car.driftArm = t.driftArmTicks;
    car.brakeTicks = 0;
  }
  if (inp.throttle > 0.5) {
    if (car.liftTicks > 0 && car.liftTicks <= t.liftTapTicks) car.driftArm = t.driftArmTicks;
    car.liftTicks = 0;
  } else if (car.liftTicks < 255) {
    car.liftTicks++;
  }
  if (car.driftArm <= 0) return;
  car.driftArm--;
  if (fwd < t.driftMinSpeed || Math.abs(car.steer) < t.driftMinSteer) return;
  const dir = car.steer > 0 ? 1 : -1;
  if (car.sliding && (car.slip > 0 ? 1 : -1) === dir) return;
  car.sliding = 1;
  car.modeTicks = 0;
  car.driftArm = 0;
  if (dir * car.angVel < t.driftKick) car.angVel = dir * t.driftKick;
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
