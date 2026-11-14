// AI driver. It reads only the world state (no hidden memory), so a client
// re-simulating the world predicts AI cars exactly.
//
// Steering is pure pursuit on the racing line, applied to the direction of
// travel rather than the nose. In a slide it also holds the slip angle the
// tyres need to swing the velocity at the required rate, so drifting emerges
// from the same physics players use.

import { DEG, clamp, headingOf, smoothstep, wrapAngle } from '../math/angle.ts';
import { hash3 } from '../math/rng.ts';
import { laneOffset, pitLocal, pitWallOffset, sampleU } from '../track/pit.ts';
import type { SurfaceMix } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import type { Track } from '../track/types.ts';
import { gripBudget, gripOmegaMax, powerOversteer, slideOmegaMax, type CarState } from '../sim/car.ts';
import { Btn, type CarInput } from '../sim/input.ts';
import { effectiveSkill, personaOf } from './persona.ts';
import { expect, notice, PLANNED_SLIDE, Sense } from './reaction.ts';
import { roadBrakeScale, roadGripScale, roadSlideScale } from '../sim/weather.ts';
import { DMath } from '../math/dmath.ts';

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
  /** Shortest drift tap; each tap is held up to 3 ticks longer (nobody taps frame-perfect). */
  tapTicks: 3,
  /** No bend tighter than this radius (m) within 80 m: a straight, drive it straight. */
  straightR: 150,
  /** Share of the grip budget steering may use on a straight. */
  straightGrip: 0.8,
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

/** When computer drivers take the pit lane, and how fast they drive in it. */
export const AI_PIT = {
  /** Damage that sends a car in (personalities shift it). */
  damage: 0.5,
  /** Distance before the lane where it lines up for the entry. */
  approach: 70,
  vEntry: 22,
  vLane: 18,
  /** In the box: slow enough for several seconds of repairs. */
  vBox: 11,
  /** Elimination race, in last place: added to the damage that sends a car in (a stop there is the end). */
  danger: 0.35,
};

const pitLoc = { u: 0, lat: 0 };

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

/**
 * Highest speed from which the car can still slow for every corner ahead.
 * `aGentle` caps the lateral grip planned for bends gentler than a straight's
 * (driven with grip, never slid; see straightR).
 */
export function plannedSpeed(track: Track, from: number, aLat: number, aBrake: number, vCap: number, aGentle = Infinity): number {
  const line = track.line;
  const n = track.n;
  const gentle = 1 / AI_PARAMS.straightR;
  let vAllowed = vCap;
  let dist = 0;
  let k = from;
  while (dist < AI_PARAMS.planAhead) {
    const kap = Math.abs(line.curv[k]);
    if (kap > 1e-4) {
      const vt = Math.sqrt((kap < gentle ? Math.min(aLat, aGentle) : aLat) / kap);
      const va = Math.sqrt(vt * vt + 2 * aBrake * dist);
      if (va < vAllowed) vAllowed = va;
    }
    dist += lineStep(track, k);
    k = k + 1 === n ? 0 : k + 1;
  }
  return vAllowed;
}

/** True if the racing line within the next 80 m bends tighter than radius r. */
function tightAhead(track: Track, from: number, r: number): boolean {
  const kap = 1 / r;
  let dist = 0;
  let k = from;
  while (dist < 80) {
    if (Math.abs(track.line.curv[k]) > kap) return true;
    dist += lineStep(track, k);
    k = k + 1 === track.n ? 0 : k + 1;
  }
  return false;
}

/**
 * `lean`: sideways shift (m) toward an item crate close to the line (sim/crates.ts crateLean).
 * `danger`: 0..1, how close the car is to going out of an elimination race (sim/elimination.ts).
 */
export function aiDrive(
  car: CarState, track: Track, t: CarTuning, surf: SurfaceMix, cars: readonly CarState[], tick: number, out: CarInput, lean = 0, danger = 0,
): void {
  const line = track.line;
  const n = track.n;
  const s = DMath.hypot(car.vx, car.vz);
  const fx = DMath.sin(car.heading);
  const fz = -DMath.cos(car.heading);
  const fwd = car.vx * fx + car.vz * fz;
  const persona = personaOf(car.aiPersona);
  // Grip lovers only slide the corners tighter than their limit.
  const drift = car.aiMode === AiMode.Drift && (persona.gripR === 0 || car.sliding > 0 || tightAhead(track, car.trackIdx, persona.gripR));
  const skill = effectiveSkill(car, persona);
  // On a straight a slide is never wanted: no flicks, and a slide is caught.
  const calm = !tightAhead(track, car.trackIdx, AI_PARAMS.straightR);
  // Weaker drivers corner slower, brake earlier, hold less top speed and wander off the line.
  const lack = clamp(1 - skill, 0, 1);
  const rx = DMath.cos(car.heading);
  const rz = DMath.sin(car.heading);

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
  // Somebody near enough to keep an eye on: a car seen coming is anticipated,
  // one that suddenly turns up close is reacted to a moment later.
  let near = false;
  if (car.ghostTicks === 0) {
    for (const o of cars) {
      if (o === car || o.ghostTicks > 0 || Math.abs(o.y - car.y) > 1.5) continue;
      const dx = o.x - car.x;
      const dz = o.z - car.z;
      const ahead = dx * fx + dz * fz;
      const side = dx * rx + dz * rz;
      if (ahead > -12 && ahead < 45 && Math.abs(side) < 8) near = true;
      if (Math.abs(side) > 3.4) continue;
      const theirs = o.vx * fx + o.vz * fz;
      if (persona.block > 0 && ahead < -2 && ahead > -12 && theirs - fwd > 0.5) {
        // Hard to pass: drift across toward a faster car close behind.
        dodge += (side > 0 ? 1 : -1) * persona.block * (1 + ahead / 12);
        continue;
      }
      if (ahead < 1 || ahead > 16) continue;
      if (fwd - theirs <= 0.5) continue;
      dodge += (side > 0 ? -1 : 1) * (1 - ahead / 16) * 4 * persona.give;
      if (ahead < 8 * Math.min(1, persona.give)) vTraffic = Math.min(vTraffic, theirs + ahead * 0.8 * roadBrakeScale(surf.wet));
    }
  }
  if (!notice(car, persona, Sense.Traffic, near, tick)) {
    dodge = 0;
    vTraffic = Infinity;
  }

  // --- Pit stop: a battered car takes the pit lane, and once off the road it stays in it.
  const pit = track.pit;
  let pitting = false;
  if (pit) {
    // Only near the start straight (the lap's progress says so), not wherever
    // another part of the track happens to line up with it.
    const uTrack = sampleU(track, car.trackIdx);
    if (uTrack >= pit.a - AI_PIT.approach && uTrack <= pit.b + 10) {
      pitLocal(pit, car.x, car.z, pitLoc);
      const inLane = pitLoc.u >= pit.a && pitLoc.u <= pit.b && pitLoc.lat > pit.barrier && pitLoc.lat <= pitWallOffset(pit, pitLoc.u) + 1;
      pitting = inLane || (car.damage >= AI_PIT.damage + persona.pitShift + danger * AI_PIT.danger && uTrack <= pit.a + pit.ramp * 0.5);
    }
  }

  // --- Speed: brake early enough for every corner within planning range (on a wet road, with wet grip).
  const wet = surf.wet;
  const aLat = (drift ? t.aSlide * AI_PARAMS.latSlide * roadSlideScale(wet) : t.aGrip * AI_PARAMS.latGrip * roadGripScale(wet)) * skill;
  const aBrake = t.brakeDecel * AI_PARAMS.brakeUse * persona.brake * (1 - lack * SKILL_PARAMS.brake) * roadBrakeScale(wet);
  // Gentle bends are driven with grip (never slid), and the wetter, the more carefully.
  const aGentle = wet > 0 ? (t.aGrip * AI_PARAMS.straightGrip * roadGripScale(wet) * skill) / (wet * wet) : Infinity;
  let vAllowed = Math.min(vTraffic, plannedSpeed(track, car.trackIdx, aLat, aBrake, t.vTop * 1.5, aGentle));
  let throttle = 1;
  let brake = 0;
  if (pitting && pit) {
    const u = pitLoc.u;
    const cap = u < pit.a ? AI_PIT.vEntry : u >= pit.box0 && u <= pit.box1 ? AI_PIT.vBox : AI_PIT.vLane;
    vAllowed = Math.min(vAllowed, cap);
  }
  if (s > vAllowed + 0.3) {
    throttle = 0;
    brake = clamp((s - vAllowed) / 1.5, 0.3, 1);
  } else if (s > vAllowed - 0.5) {
    throttle = 0.35;
  }
  // Weaker drivers ease off below top speed (rolling, never braking for it).
  if (lack > 0 && s > t.vTop * (1 - lack * SKILL_PARAMS.straight)) throttle = Math.min(throttle, 0.3);
  // Standing still (the start, after a tow): it takes a moment to get going.
  if (!notice(car, persona, Sense.Go, s < 3 && throttle > 0, tick) && s < 0.5) throttle = 0;
  // A lazy starter gets going gently on the first lap.
  if (persona.launch < 1 && car.lap <= 1 && s < 20) throttle = Math.min(throttle, persona.launch);

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
  const loose = lack * SKILL_PARAMS.wander + persona.wander;
  const stray = loose > 0 ? clamp(wander(car.id, tick) * loose, -lim / 2, lim / 2) : 0;
  // A crate close to the line: only with nobody near and no pit stop on.
  const off = dodge + stray + (near || pitting ? 0 : lean);
  const shift = clamp(line.off[j] + off, -lim, lim) - line.off[j];
  let dx = line.x[j] + track.nx[j] * shift - car.x;
  let dz = line.z[j] + track.nz[j] * shift - car.z;
  if (pitting && pit) {
    // Follow the middle of the pit lane (back onto the racing line past its end).
    const ut = pitLoc.u + look;
    if (ut < pit.b) {
      const lat = (ut < pit.a ? pit.roadOff : laneOffset(pit, ut)) * pit.side;
      dx = pit.ox + pit.tx * ut + pit.nx * lat - car.x;
      dz = pit.oz + pit.tz * ut + pit.nz * lat - car.z;
    }
  }
  const ld = DMath.hypot(dx, dz);
  const travel = s > 2 ? headingOf(car.vx, car.vz) : car.heading;
  const alpha = wrapAngle(headingOf(dx, dz) - travel);
  const turnRate = (s * 2 * DMath.sin(alpha)) / Math.max(ld, 1);

  const dirHeading = fwd >= 0 ? car.heading : car.heading + Math.PI;
  const beta = s > 2 ? wrapAngle(dirHeading - travel) : 0;
  let omegaDes: number;
  if (car.sliding) {
    // In a slide the velocity swings toward the nose at min(kAlign·|β|, aSlide/s).
    // Hold the slip that gives the needed turn rate; more slip than the cap
    // needs only scrubs speed.
    const capRate = t.aSlide / Math.max(s, 1);
    const maxB = Math.min(AI_PARAMS.maxBetaDeg * DEG, (capRate / t.kAlign) * 1.15);
    // A slide on a straight that it did not go for: straighten out, steer back with grip.
    const betaDes = calm && !(car.aiAware & PLANNED_SLIDE) ? 0 : clamp(turnRate / t.kAlign, -maxB, maxB);
    const velRate = (beta > 0 ? 1 : -1) * Math.min(t.kAlign * Math.abs(beta), capRate);
    omegaDes = velRate + AI_PARAMS.kSlip * (betaDes - beta);
  } else {
    omegaDes = turnRate + AI_PARAMS.kHeading * -beta;
  }
  // Lead compensation for the lag between commanded and actual yaw rate.
  omegaDes += AI_PARAMS.kLead * (omegaDes - car.angVel);

  // Invert the yaw model from car.ts to find the steering that gives omegaDes.
  const aEngGuess = throttle * t.accel0 * surf.accel * Math.max(0, 1 - DMath.sq(fwd / (t.vTop * surf.vTop)));
  const budget = gripBudget(t, surf, brake, aEngGuess);
  let omegaMax: number;
  let extra = 0;
  if (!car.sliding) {
    // On a straight never ask the tyres for more than they give (weaving round
    // traffic, ice): that is what tips a gripping car into a slide.
    if (calm && s > 5) omegaDes = clamp(omegaDes, (-budget * AI_PARAMS.straightGrip) / s, (budget * AI_PARAMS.straightGrip) / s);
    omegaMax = gripOmegaMax(t, s, budget * surf.steerAsk, surf.slippery > 0);
    // On a wet road full lock asks more than the tyres give: never ask for more than there is.
    if (surf.steerAsk > 1) {
      const cap = gripOmegaMax(t, s, budget, surf.slippery > 0);
      omegaDes = clamp(omegaDes, -cap, cap);
    }
  } else {
    omegaMax = slideOmegaMax(t, s);
    // The power slide depends on the steering being solved for: use the wheel as it is now.
    extra = powerOversteer(t, beta, car.steer * (fwd >= 0 ? 1 : -1), throttle) - t.assistPad * beta;
  }
  const dirSign = fwd >= 0 ? 1 : -1;
  let steer = omegaMax > 1e-3 ? clamp(((omegaDes - extra) / omegaMax) * dirSign, -1, 1) : 0;

  // A slide it went for in a bend is expected; any other one (a knock, a bump)
  // is caught only after the reaction time, until then the wheel stays put.
  if (car.sliding && drift && !calm) {
    expect(car, Sense.Slide);
    car.aiAware |= PLANNED_SLIDE;
  } else if (!car.sliding) {
    car.aiAware &= ~PLANNED_SLIDE;
  }
  const caught = notice(car, persona, Sense.Slide, car.sliding === 1, tick);
  if (car.sliding && calm && caught && !(car.aiAware & PLANNED_SLIDE) && Math.abs(beta) > t.slipExitDeg * DEG) {
    // Off the power until it straightens, or the throttle keeps it sideways.
    throttle = Math.min(throttle, 0.4);
  }

  // Traction control while gripping: hard acceleration eats lateral grip, so
  // ease off (but stay above the lift threshold) when the corner needs most of it.
  if (!car.sliding && throttle > 0.55) {
    const fullThrottle = t.accel0 * surf.accel * Math.max(0, 1 - DMath.sq(fwd / (t.vTop * surf.vTop)));
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
  // On a straight a pedal blip must not throw it sideways: keep the wheel under the flick threshold.
  if (calm && !car.sliding) {
    const arming = car.driftArm > 0
      || (car.liftTicks > 0 && car.liftTicks <= t.liftTapTicks && throttle > 0.5)
      || (car.brakeTicks > 0 && car.brakeTicks <= t.driftTapTicks && brake <= 0.5);
    const cap = t.driftMinSteer - 0.02;
    if (arming) steer = clamp(steer, -cap, cap);
  }

  // Drift entry: when the corner needs more grip than the tyres have, tap the
  // brake while steering (press a few ticks, release) like a player would.
  if (drift && !calm && !car.sliding && fwd > t.driftMinSpeed && Math.abs(steer) >= t.driftMinSteer) {
    if (Math.abs(turnRate) * s > budget * AI_PARAMS.tapRatio) {
      // The press started at tick - brakeTicks; its length is fixed when it starts.
      const tap = AI_PARAMS.tapTicks + Math.floor(hash3(car.id, tick - car.brakeTicks, 17) * 4);
      if (car.brakeTicks < tap) {
        brake = 1;
        throttle = 0;
      } else {
        brake = 0;
      }
    }
  }

  if (car.sliding && !caught) {
    // Not reacted yet: hands and feet as they were.
    steer = car.steer;
    brake = 0;
  }

  out.steer = steer;
  out.throttle = throttle;
  out.brake = brake;
  out.buttons = Btn.Analog;
}
