// AI driver. It reads only the world state (no hidden memory), so a client
// re-simulating the world predicts AI cars exactly.
//
// Steering is pure pursuit on the racing line, applied to the direction of
// travel rather than the nose. In a slide it also holds the slip angle the
// tyres need to swing the velocity at the required rate, so drifting emerges
// from the same physics players use.

import { DEG, clamp, headingOf, smoothstep, wrapAngle } from '../math/angle.ts';
import type { SurfaceMix } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import type { Track } from '../track/types.ts';
import { gripBudget, gripOmegaMax, slideOmegaMax, type CarState } from '../sim/car.ts';
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

export function aiDrive(car: CarState, track: Track, t: CarTuning, surf: SurfaceMix, out: CarInput): void {
  const line = track.line;
  const n = track.n;
  const s = Math.hypot(car.vx, car.vz);
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  const fwd = car.vx * fx + car.vz * fz;
  const drift = car.aiMode === AiMode.Drift;
  const skill = car.aiSkill;

  // --- Speed: brake early enough for every corner within planning range.
  const aLat = (drift ? t.aSlide * AI_PARAMS.latSlide : t.aGrip * AI_PARAMS.latGrip) * skill;
  const vAllowed = plannedSpeed(track, car.trackIdx, aLat, t.brakeDecel * AI_PARAMS.brakeUse, t.vTop * 1.5);
  let throttle = 1;
  let brake = 0;
  if (s > vAllowed + 0.3) {
    throttle = 0;
    brake = clamp((s - vAllowed) / 1.5, 0.3, 1);
  } else if (s > vAllowed - 0.5) {
    throttle = 0.35;
  }

  // --- Steering: pure pursuit toward a point ahead on the racing line.
  const look = clamp(AI_PARAMS.lookBase + AI_PARAMS.lookTime * s, AI_PARAMS.lookMin, AI_PARAMS.lookMax);
  let j = car.trackIdx;
  let acc = 0;
  while (acc < look) {
    acc += lineStep(track, j);
    j = j + 1 === n ? 0 : j + 1;
  }
  const dx = line.x[j] - car.x;
  const dz = line.z[j] - car.z;
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
    const bs = beta > 0 ? 1 : beta < 0 ? -1 : 0;
    extra = bs * t.kPow * throttle * smoothstep(3 * DEG, 15 * DEG, Math.abs(beta)) - t.assistPad * beta;
  }
  const dirSign = fwd >= 0 ? 1 : -1;
  const steer = omegaMax > 1e-3 ? clamp(((omegaDes - extra) / omegaMax) * dirSign, -1, 1) : 0;

  // A short brake pulse while steering would start a drift; when not
  // drifting, keep the brake on past the tap window instead.
  if (!drift && car.brakeTicks > 0 && car.brakeTicks <= t.driftTapTicks && brake <= 0.5 && Math.abs(steer) >= t.driftMinSteer) {
    brake = 0.55;
    throttle = 0;
  }

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
