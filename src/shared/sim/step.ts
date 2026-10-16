// One fixed simulation tick for the whole world: race phases, cars, AI,
// collisions, progress, finishing, and getting stuck cars going again.

import { DT } from '../config/constants.ts';
import { wrapAngle } from '../math/angle.ts';
import { makeSurfaceMix, mixSurfaces, type SurfaceId } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import { aiDrive } from '../ai/driver.ts';
import { aiWeapons } from '../ai/weapons.ts';
import { surfaceAt } from '../track/builder.ts';
import type { Track } from '../track/types.ts';
import { applyDamage, stepCarDynamics, type CarState } from './car.ts';
import { clampSpeed, collideCarWithWalls, collideCars } from './collision.ts';
import { Ev, pushEvent } from './events.ts';
import { Btn, NEUTRAL_INPUT, neutralInput, type CarInput } from './input.ts';
import { resetProgress, updateProgress } from './race.ts';
import { RacePhase, respawnCar, standings, type World } from './world.ts';
import { fellOff, groundUnder, makeGround, safeRespawnS, stepRamps } from './ramps.ts';
import {
  applyImpactDamage, checkWreck, stepBoostAndAir, stepShots, stepWreck, useWeapons, WEAPON,
} from './weapons.ts';

const aiInput = neutralInput();
const surfMix = makeSurfaceMix();
const ground = makeGround();

/** Stopped this long while trying to move: put the car back on the track. */
const STUCK_RESPAWN_TICKS = 240;
/** AI facing the wrong way this long: put it back on the track. */
const AI_WRONG_WAY_TICKS = 150;
/** After the first car finishes, everybody else gets this long. */
const FINISH_TIMEOUT_TICKS = 60 * 45;
/** Battles spread the field out more. */
const FINISH_TIMEOUT_WEAPONS = 60 * 75;
/** Pause between the last human finishing and the race ending. */
const END_DELAY_TICKS = 60 * 3;

export function sampleCarSurface(car: CarState, track: Track, t: CarTuning): void {
  const fx = Math.sin(car.heading);
  const fz = -Math.cos(car.heading);
  car.surfFront = surfaceAt(track, car.x + fx * t.circleOffset, car.z + fz * t.circleOffset);
  car.surfRear = surfaceAt(track, car.x - fx * t.circleOffset, car.z - fz * t.circleOffset);
}

/**
 * Advance the world by one tick. `inputs[i]` drives car i unless the car is
 * AI-driven; `tunings[i]` (or tunings[0]) holds its effective handling.
 */
export function stepWorld(w: World, track: Track, inputs: readonly (CarInput | undefined)[], tunings: readonly CarTuning[]): void {
  w.events.count = 0;
  const race = w.race;
  const cars = w.cars;

  if (race.phase === RacePhase.Countdown) {
    if (w.tick + 1 >= race.startTick) {
      race.phase = RacePhase.Racing;
      pushEvent(w.events, Ev.RaceStart, -1, -1, 0, 0, 0);
    }
    // Cars wait on the grid; inputs only feed the engine sound.
    w.tick++;
    return;
  }

  const armed = race.weapons === 1 && race.phase === RacePhase.Racing && w.tick >= race.startTick + WEAPON.startGrace;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const t = tunings[i] ?? tunings[0];
    let inp: CarInput = inputs[i] ?? NEUTRAL_INPUT;
    if (car.wreckTicks > 0) {
      stepWreck(car, DT);
      // A car wrecked in mid-air still falls.
      if (car.airborne) {
        groundUnder(car, track, ground);
        stepBoostAndAir(car, t, DT, w.events, false, ground.gap ? 0 : ground.h);
      }
      if (--car.wreckTicks === 0) {
        // Towed back onto the track, patched up.
        respawnCar(car, track, safeRespawnS(track, car.trackS - 4));
        car.damage = WEAPON.wreckRepair;
        pushEvent(w.events, Ev.Respawn, car.id, -1, 2, car.x, car.z);
      }
      car.prevButtons = 0;
      car.stuckTicks = 0;
      if (car.ghostTicks > 0) car.ghostTicks--;
      continue;
    }
    sampleCarSurface(car, track, t);
    mixSurfaces(car.surfFront as SurfaceId, car.surfRear as SurfaceId, surfMix);
    applyDamage(surfMix, car.damage, t);
    if (car.aiDriven) {
      aiDrive(car, track, t, surfMix, cars, w.tick, aiInput);
      if (armed) aiWeapons(car, cars, track, w.tick, t.vTop, aiInput);
      inp = aiInput;
    } else if (inp.buttons & Btn.Reset && !(car.prevButtons & Btn.Reset) && race.phase === RacePhase.Racing && !car.finished) {
      // The driver asked to be put back on the track.
      respawnCar(car, track, safeRespawnS(track, car.trackS));
      resetProgress(car, track);
      pushEvent(w.events, Ev.Respawn, car.id, -1, 1, car.x, car.z);
    }
    if (armed) useWeapons(car, inp, w.shots, w.events);
    if (car.airborne) {
      // Flying after a mine: no grip, keep going.
      car.heading = wrapAngle(car.heading + car.angVel * DT);
      car.x += car.vx * DT;
      car.z += car.vz * DT;
    } else {
      stepCarDynamics(car, inp, t, surfMix, DT);
    }
    groundUnder(car, track, ground);
    if (fellOff(car, ground)) {
      // Into the hole of a broken bridge: back to the run-up.
      respawnCar(car, track, safeRespawnS(track, car.trackS));
      car.respawns++;
      pushEvent(w.events, Ev.Respawn, car.id, -1, 3, car.x, car.z);
    } else {
      const i = car.trackIdx;
      const along = car.vx * track.tx[i] + car.vz * track.tz[i];
      stepBoostAndAir(car, t, DT, w.events, race.weapons === 1, ground.gap ? -1e9 : ground.h, along * ground.slope);
      stepRamps(car, track, ground);
    }
    car.prevButtons = inp.buttons;

    // Stuck: nearly stopped while trying to drive.
    const speed = Math.hypot(car.vx, car.vz);
    const trying = (car.aiDriven || inp.throttle > 0.3 || inp.brake > 0.3) && !car.airborne;
    if (speed < 1.2 && trying && race.phase === RacePhase.Racing) car.stuckTicks++;
    else if (car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading) > 4) car.stuckTicks = 0;
    if (car.ghostTicks > 0) car.ghostTicks--;
  }
  if (race.weapons) stepShots(w.shots, cars, track, tunings, DT, w.events);
  const knocks = w.events.count;
  for (let i = 0; i < cars.length; i++) {
    collideCarWithWalls(cars[i], tunings[i] ?? tunings[0], track.walls, w.events);
  }
  for (let i = 0; i < cars.length; i++) {
    if (cars[i].ghostTicks > 0 || cars[i].wreckTicks > 0) continue;
    for (let j = i + 1; j < cars.length; j++) {
      if (cars[j].ghostTicks > 0 || cars[j].wreckTicks > 0) continue;
      collideCars(cars[i], cars[j], tunings[i] ?? tunings[0], tunings[j] ?? tunings[0], w.events);
    }
  }
  if (race.weapons && race.phase === RacePhase.Racing) {
    applyImpactDamage(cars, tunings, w.events, knocks);
    for (const car of cars) checkWreck(car, cars, w.events);
  }
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    clampSpeed(car);
    const lapsBefore = car.lap;
    updateProgress(car, track, w.tick, w.events);
    if (race.laps > 0 && !car.finished && car.lap > lapsBefore && lapsBefore >= race.laps) finishCar(w, car);
    const lost = car.stuckTicks > STUCK_RESPAWN_TICKS || (car.aiDriven && car.wrongWayTicks > AI_WRONG_WAY_TICKS);
    if (lost && !car.finished && car.wreckTicks === 0) {
      respawnCar(car, track, safeRespawnS(track, car.trackS - 4));
      car.respawns++;
      pushEvent(w.events, Ev.Respawn, car.id, -1, 0, car.x, car.z);
    }
  }

  // Race end: all people done (or everybody), or the post-finish timeout.
  if (race.phase === RacePhase.Racing && race.laps > 0 && race.finishOrder.length > 0) {
    let humans = 0;
    let humansDone = 0;
    let latestHumanFinish = 0;
    for (const c of cars) {
      if (!c.human) continue;
      humans++;
      if (c.finished) {
        humansDone++;
        latestHumanFinish = Math.max(latestHumanFinish, c.finishTick);
      }
    }
    const allDone = race.finishOrder.length === cars.length;
    const humansAllDone = humans > 0 && humansDone === humans && w.tick >= latestHumanFinish + END_DELAY_TICKS;
    if (allDone || humansAllDone || w.tick >= race.firstFinishTick + (race.weapons ? FINISH_TIMEOUT_WEAPONS : FINISH_TIMEOUT_TICKS)) {
      race.phase = RacePhase.Finished;
      race.endTick = w.tick;
      pushEvent(w.events, Ev.RaceEnd, -1, -1, 0, 0, 0);
    }
  }

  const order = standings(w);
  for (let k = 0; k < order.length; k++) cars[order[k]].place = k + 1;
  w.tick++;
}

function finishCar(w: World, car: CarState): void {
  car.finished = 1;
  car.finishTick = w.tick;
  if (w.race.finishOrder.length === 0) w.race.firstFinishTick = w.tick;
  w.race.finishOrder.push(car.id);
  // Cool-down lap on autopilot, out of everybody's way.
  car.aiDriven = 1;
  car.ghostTicks = 30000;
  pushEvent(w.events, Ev.Finish, car.id, w.race.finishOrder.length, w.tick - w.race.startTick, car.x, car.z);
}
