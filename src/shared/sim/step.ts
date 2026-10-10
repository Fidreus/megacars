// One fixed simulation tick for the whole world: race phases, cars, AI,
// collisions, progress, finishing, and getting stuck cars going again.

import { DT } from '../config/constants.ts';
import { makeSurfaceMix, mixSurfaces, type SurfaceId } from '../config/surfaces.ts';
import type { CarTuning } from '../config/tuning.ts';
import { aiDrive } from '../ai/driver.ts';
import { surfaceAt } from '../track/builder.ts';
import type { Track } from '../track/types.ts';
import { stepCarDynamics, type CarState } from './car.ts';
import { clampSpeed, collideCarWithWalls, collideCars } from './collision.ts';
import { Ev, pushEvent } from './events.ts';
import { NEUTRAL_INPUT, neutralInput, type CarInput } from './input.ts';
import { updateProgress } from './race.ts';
import { RacePhase, respawnCar, standings, type World } from './world.ts';

const aiInput = neutralInput();
const surfMix = makeSurfaceMix();

/** Stopped this long while trying to move: put the car back on the track. */
const STUCK_RESPAWN_TICKS = 240;
/** AI facing the wrong way this long: put it back on the track. */
const AI_WRONG_WAY_TICKS = 150;
/** After the first car finishes, everybody else gets this long. */
const FINISH_TIMEOUT_TICKS = 60 * 45;
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

  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const t = tunings[i] ?? tunings[0];
    let inp: CarInput = inputs[i] ?? NEUTRAL_INPUT;
    sampleCarSurface(car, track, t);
    mixSurfaces(car.surfFront as SurfaceId, car.surfRear as SurfaceId, surfMix);
    if (car.aiDriven) {
      aiDrive(car, track, t, surfMix, cars, aiInput);
      inp = aiInput;
    }
    stepCarDynamics(car, inp, t, surfMix, DT);
    car.prevButtons = inp.buttons;

    // Stuck: nearly stopped while trying to drive.
    const speed = Math.hypot(car.vx, car.vz);
    const trying = car.aiDriven || inp.throttle > 0.3 || inp.brake > 0.3;
    if (speed < 1.2 && trying && race.phase === RacePhase.Racing) car.stuckTicks++;
    else if (car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading) > 4) car.stuckTicks = 0;
    if (car.ghostTicks > 0) car.ghostTicks--;
  }
  for (let i = 0; i < cars.length; i++) {
    collideCarWithWalls(cars[i], tunings[i] ?? tunings[0], track.walls, w.events);
  }
  for (let i = 0; i < cars.length; i++) {
    if (cars[i].ghostTicks > 0) continue;
    for (let j = i + 1; j < cars.length; j++) {
      if (cars[j].ghostTicks > 0) continue;
      collideCars(cars[i], cars[j], tunings[i] ?? tunings[0], tunings[j] ?? tunings[0], w.events);
    }
  }
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    clampSpeed(car);
    const lapsBefore = car.lap;
    updateProgress(car, track, w.tick, w.events);
    if (race.laps > 0 && !car.finished && car.lap > lapsBefore && lapsBefore >= race.laps) finishCar(w, car);
    const lost = car.stuckTicks > STUCK_RESPAWN_TICKS || (car.aiDriven && car.wrongWayTicks > AI_WRONG_WAY_TICKS);
    if (lost && !car.finished) {
      respawnCar(car, track, car.trackS - 4);
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
    if (allDone || humansAllDone || w.tick >= race.firstFinishTick + FINISH_TIMEOUT_TICKS) {
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
