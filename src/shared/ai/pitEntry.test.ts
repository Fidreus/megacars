import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../config/tuning.ts';
import { headingOf } from '../math/angle.ts';
import { getTrack } from '../track/builder.ts';
import { BREWERY_BASH } from '../track/defs/breweryBash.ts';
import { MANHATTAN_SPRINT } from '../track/defs/manhattanSprint.ts';
import { pitLocal } from '../track/pit.ts';
import { resetProgress } from '../sim/race.ts';
import { stepWorld } from '../sim/step.ts';
import { createWorld } from '../sim/world.ts';

describe('a computer car that slid into the pit entry', () => {
  for (const def of [BREWERY_BASH, MANHATTAN_SPRINT]) {
    it(`drives on down the pit lane instead of back into the island (${def.id})`, () => {
      const track = getTrack(def);
      const pit = track.pit!;
      const w = createWorld(track, 1, 1, { laps: 3, countdownTicks: 0 });
      const car = w.cars[0];
      car.aiDriven = 1;
      // Stopped just before the island, beyond the road's barrier line, nose turned toward the road.
      const u = pit.box0 - 3;
      const lat = (pit.barrier + 1.2) * pit.side;
      car.x = pit.ox + pit.tx * u + pit.nx * lat;
      car.z = pit.oz + pit.tz * u + pit.nz * lat;
      car.heading = headingOf(pit.tx - pit.nx * pit.side * 0.5, pit.tz - pit.nz * pit.side * 0.5);
      car.vx = car.vz = 0;
      resetProgress(car, track);
      const loc = { u: 0, lat: 0 };
      let past = false;
      for (let k = 0; k < 60 * 20 && !past; k++) {
        stepWorld(w, track, [], [DEFAULT_TUNING]);
        pitLocal(pit, car.x, car.z, loc);
        past = loc.u > pit.b;
      }
      expect(past).toBe(true);
      expect(car.respawns).toBe(0);
    });
  }
});
