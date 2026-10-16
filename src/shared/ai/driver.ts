// AI driver. It reads only the world state (no hidden memory), so a client
// re-simulating the world predicts AI cars exactly.
//
// Steering is pure pursuit on the racing line, applied to the direction of
// travel rather than the nose. In a slide it also holds the slip angle the
// tyres need to swing the velocity at the required rate, so drifting emerges
// from the same physics players use.

import { DEG, clamp, headingOf, smoothstep, wrapAngle } from '../math/angle.ts';
import { hash3 } from '../math/rng.ts';
import type { SurfaceMix } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import type { Track } from '../track/types.ts';
import { gripBudget, gripOmegaMax, powerOversteer, slideOmegaMax, type CarState } from '../sim/car.ts';
import { Btn, type CarInput } from '../sim/input.ts';

export const AiMode = { Grip: 0, Drift: 1 } as const;

export const AI_PARAMS = {
  lookBase: 5,
  lookTime: 0.3,
  lookMin: 7,
  lookMax: 42,
  kHeading: 4,
  kSlip: 5,
  kLead: 0.6,
  maxBetaDeg: 30,
  /** Share of the lateral budget the speed planner uses. */
  latGrip: 0.9,
  latSlide: 0.85,
  /** Share of full braking the planner assumes. */
  brakeUse: 0.85,
  planAhead: 200,
  /** Tap the brake to drift when the corner needs this share of the grip budget. */
  tapRatio: 0.97,
  tapTicks: 4,
};

/** Skill shortfall (0 = flawless, the old default) that each knob scales with. */
export const SKILL_PARAMS = {
  /** Share of top speed given up per unit of shortfall. */
  straight: 0.5,
  /** Share of braking given up (brakes earlier) per unit of shortfall. */
  brake: 1,
  /** Metres the line wanders per unit of shortfall. */
  wander: 8,
  /** Ticks between wander targets. */
  wanderTicks: 90,
};

/** A slow, smooth -1..1 drift off the racing line, the same on every machine. */
function wander(id: number, tick: number): number {
  const seg = Math.floor(tick / SKILL_PARAMS.wanderTicks);
  const f = smoothstep(0, 1, (tick - seg * SKILL_PARAMS.wanderTicks) / SKILL_PARAMS.wanderTicks);
  const a = hash3(id, seg, 77);
  const b = hash3(id, seg + 1, 77);
  return (a + (b - a) * f) * 2 - 1;
}

function lineStep(track: Track, i: number): number {
  const line = track.line;
  const j = i + 1 === track.n ? 0 : i + 1;
  return j === 0 ? line.length - line.s[i] : line.s[j] - line.s[i];
}

/** Highest speed from which the car can still slow for every corner ahead. */
export function plannedSpeed(track: Track, from: number, aLat: number, aBrake: number, vCap: number): number {
  const line = track.line;
  const n = track.n;
  let vAllowed = vCap;
  let dist = 0;
  let k = from;
  while (dist < AI_PARAMS.planAhead) {
    const kap = Math.abs(line.curv[k]);
    if (kap > 1e-4) {
      const vt = Math.sqrt(aLat / kap);
      const va = Math.sqrt(vt * vt + 2 * aBrake * dist);
      if (va < vAllowed) vAllowed = va;
    }
    dist += lineStep(track, k);
    k = k + 1 === n ? 0 : k + 1;
  }
  return vAllowed;
}

export function aiDrive(
  car: CarState, track: Track, t: CarTuning, surf: SurfaceMix, cars: readonly CarState[], tick: number, out: CarInput,
): void {
  const line = track.line;
  const n = track.n;
  const s = Math.hypot(car.vx, car.vz);
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const fwd = car.vx * fx + car.vz * fz;
  const drift = car.aiMode === AiMode.Drift;
  const skill = car.aiSkill;
  // Weaker drivers corner slower, brake earlier, hold less top speed and wander off the line.
  const lack = clamp(1 - skill, 0, 1);
  const rx = Math.cos(car.heading);
  const rz = Math.sin(car.heading);

  // --- Getting unstuck: back away from the obstacle, nose turning toward the line.
  if (car.aiReverseTicks === 0 && (car.stuckTicks === 40 || car.stuckTicks === 140)) car.aiReverseTicks = 75;
  if (car.aiReverseTicks > 0) {
    car.aiReverseTicks--;
    const j = (car.trackIdx + 12) % n;
    const err = wrapAngle(headingOf(line.x[j] - car.x, line.z[j] - car.z) - car.heading);
    out.steer = err > 0 ? -1 : 1;
    out.throttle = 0;
    out.brake = 1;
    out.buttons = Btn.Analog;
    return;
  }

  // --- Traffic: slide over to pass a slower car close ahead; brake if about to hit it.
  let dodge = 0;
  let vTraffic = Infinity;
  if (car.ghostTicks === 0) {
    for (const o of cars) {
      if (o === car || o.ghostTicks > 0 || Math.abs(o.y - car.y) > 1.5) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 1 || ahead > 16) continue;
      const side = dx * rx + dz * rz;
      if (Math.abs(side) > 3.4) continue;
      const theirs = o.vx * fx + o.vz * fz;
      if (fwd - theirs <= 0.5) continue;
      dodge += (side > 0 ? -1 : 1) * (1 - ahead / 16) * 4;
      if (ahead < 8) vTraffic = Math.min(vTraffic, theirs + ahead * 0.8);
    }
  }

  // --- Speed: brake early enough for every corner within planning range.
  const aLat = (drift ? t.aSlide * AI_PARAMS.latSlide : t.aGrip * AI_PARAMS.latGrip) * skill;
  const vAllowed = Math.min(
    vTraffic,
    plannedSpeed(track, car.trackIdx, aLat, t.brakeDecel * AI_PARAMS.brakeUse * (1 - lack * SKILL_PARAMS.brake), t.vTop * 1.5),
  );
  let throttle = 1;
  let brake = 0;
  if (s > vAllowed + 0.3) {
    throttle = 0;
    brake = clamp((s - vAllowed) / 1.5, 0.3, 1);
  } else if (s > vAllowed - 0.5) {
    throttle = 0.35;
  }
  // Weaker drivers ease off below top speed (rolling, never braking for it).
  if (lack > 0 && s > t.vTop * (1 - lack * SKILL_PARAMS.straight)) throttle = Math.min(throttle, 0.3);

  // --- Steering: pure pursuit toward a point ahead on the racing line.
  const look = clamp(AI_PARAMS.lookBase + AI_PARAMS.lookTime * s, AI_PARAMS.lookMin, AI_PARAMS.lookMax);
  let j = car.trackIdx;
  let acc = 0;
  while (acc < look) {
    acc += lineStep(track, j);
    j = j + 1 === n ? 0 : j + 1;
  }
  // Pursue the racing line, shifted sideways when dodging traffic.
  const lim = track.hw[j] - 1.6;
  // The wander never takes the car closer than half the road to the edge.
  const stray = lack > 0 ? clamp(wander(car.id, tick) * lack * SKILL_PARAMS.wander, -lim / 2, lim / 2) : 0;
  const off = dodge + stray;
  const shift = clamp(line.off[j] + off, -lim, lim) - line.off[j];
  const dx = line.x[j] + track.nx[j] * shift - car.x;
  const dz = line.z[j] + track.nz[j] * shift - car.z;
  const ld = Math.hypot(dx, dz);
  const travel = s > 2 ? headingOf(car.vx, car.vz) : car.heading;
  const alpha = wrapAngle(headingOf(dx, dz) - travel);
  const turnRate = (s * 2 * Math.sin(alpha)) / Math.max(ld, 1);

  const dirHeading = fwd >= 0 ? car.heading : car.heading + Math.PI;
  const beta = s > 2 ? wrapAngle(dirHeading - travel) : 0;
  let omegaDes: number;
  if (car.sliding) {
    // In a slide the velocity swings toward the nose at min(kAlign·|β|, aSlide/s).
    // Hold the slip that gives the needed turn rate; more slip than the cap
    // needs only scrubs speed.
    const capRate = t.aSlide / Math.max(s, 1);
    const maxB = Math.min(AI_PARAMS.maxBetaDeg * DEG, (capRate / t.kAlign) * 1.15);
    const betaDes = clamp(turnRate / t.kAlign, -maxB, maxB);
    const velRate = (beta > 0 ? 1 : -1) * Math.min(t.kAlign * Math.abs(beta), capRate);
    omegaDes = velRate + AI_PARAMS.kSlip * (betaDes - beta);
  } else {
    omegaDes = turnRate + AI_PARAMS.kHeading * -beta;
  }
  // Lead compensation for the lag between commanded and actual yaw rate.
  omegaDes += AI_PARAMS.kLead * (omegaDes - car.angVel);

  // Invert the yaw model from car.ts to find the steering that gives omegaDes.
  const aEngGuess = throttle * t.accel0 * surf.accel * Math.max(0, 1 - (fwd / (t.vTop * surf.vTop)) ** 2);
  const budget = gripBudget(t, surf, brake, aEngGuess);
  let omegaMax: number;
  let extra = 0;
  if (!car.sliding) {
    omegaMax = gripOmegaMax(t, s, budget, surf.slippery > 0);
  } else {
    omegaMax = slideOmegaMax(t, s);
    // The power slide depends on the steering being solved for: use the wheel as it is now.
    extra = powerOversteer(t, beta, car.steer * (fwd >= 0 ? 1 : -1), throttle) - t.assistPad * beta;
  }
  const dirSign = fwd >= 0 ? 1 : -1;
  const steer = omegaMax > 1e-3 ? clamp(((omegaDes - extra) / omegaMax) * dirSign, -1, 1) : 0;

  // Traction control while gripping: hard acceleration eats lateral grip, so
  // ease off (but stay above the lift threshold) when the corner needs most of it.
  if (!car.sliding && throttle > 0.55) {
    const fullThrottle = t.accel0 * surf.accel * Math.max(0, 1 - (fwd / (t.vTop * surf.vTop)) ** 2);
    if (Math.abs(turnRate) * s > gripBudget(t, surf, 0, fullThrottle) * 0.92) throttle = 0.55;
  }

  // A short brake pulse or throttle lift while steering would start a drift;
  // when not drifting, hold the pedal state past the flick window instead.
  if (!drift && Math.abs(steer) >= t.driftMinSteer) {
    if (car.brakeTicks > 0 && car.brakeTicks <= t.driftTapTicks && brake <= 0.5) {
      brake = 0.55;
      throttle = 0;
    }
    if (car.liftTicks > 0 && car.liftTicks <= t.liftTapTicks && throttle > 0.5) throttle = 0.5;
  }
  // Weaker drivers never flick into a slide by lifting off and back on.
  if (drift && lack > 0 && brake === 0 && car.liftTicks > 0 && car.liftTicks <= t.liftTapTicks && throttle > 0.5) throttle = 0.5;

  // Drift entry: when the corner needs more grip than the tyres have, tap the
  // brake while steering (press a few ticks, release) like a player would.
  if (drift && !car.sliding && fwd > t.driftMinSpeed && Math.abs(steer) >= t.driftMinSteer) {
    if (Math.abs(turnRate) * s > budget * AI_PARAMS.tapRatio) {
      if (car.brakeTicks < AI_PARAMS.tapTicks) {
        brake = 1;
        throttle = 0;
      } else {
        brake = 0;
      }
    }
  }

  out.steer = steer;
  out.throttle = throttle;
  out.brake = brake;
  out.buttons = Btn.Analog;
}
