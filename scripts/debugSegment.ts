// Dev tool: log an AI run through a benchmark corner tick by tick.
// Usage: node scripts/debugSegment.ts [grip|drift] [tight|sweep]
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { headingOf } from '../src/shared/math/angle.ts';
import { buildTrack, sampleIndexAt } from '../src/shared/track/builder.ts';
import { BENCH_SWEEPER, BENCH_TIGHT } from '../src/shared/track/defs/bench.ts';
import { stepWorld } from '../src/shared/sim/step.ts';
import { createWorld } from '../src/shared/sim/world.ts';
import { AiMode, plannedSpeed, AI_PARAMS } from '../src/shared/ai/driver.ts';

const mode = process.argv[2] === 'grip' ? AiMode.Grip : AiMode.Drift;
const which = process.argv[3] === 'sweep' ? { def: BENCH_SWEEPER, s0: 50, s1: 564 } : { def: BENCH_TIGHT, s0: 136, s1: 358 };
const t = DEFAULT_TUNING;
const track = buildTrack(which.def);
const world = createWorld(track, 1, 1);
const car = world.cars[0];
const i = sampleIndexAt(track, which.s0);
const j = (i + 1) % track.n;
const h = headingOf(track.line.x[j] - track.line.x[i], track.line.z[j] - track.line.z[i]);
Object.assign(car, { x: track.line.x[i], z: track.line.z[i], heading: h, vx: Math.sin(h) * 45, vz: -Math.cos(h) * 45, trackIdx: i, trackS: track.s[i], aiDriven: 1, aiMode: mode });
const aLat = mode === AiMode.Drift ? t.aSlide * AI_PARAMS.latSlide : t.aGrip * AI_PARAMS.latGrip;
// Racing line around the corner.
let minR = Infinity, minRIdx = 0;
for (let k = i; k < sampleIndexAt(track, which.s1); k++) { const r = 1 / Math.abs(track.line.curv[k]); if (r < minR) { minR = r; minRIdx = k; } }
console.log(`line min radius ${minR.toFixed(1)} m at s=${track.s[minRIdx].toFixed(0)} off=${track.line.off[minRIdx].toFixed(2)}; vLimit=${Math.sqrt(aLat * minR).toFixed(1)}`);
let tick = 0;
while (car.trackS < which.s1 && tick < 1200) {
  const vA = plannedSpeed(track, car.trackIdx, aLat, t.brakeDecel * AI_PARAMS.brakeUse, t.vTop * 1.5);
  stepWorld(world, track, [], [t]);
  tick++;
  if (tick % 6 === 0) {
    const k = car.trackIdx;
    const lat = (car.x - track.px[k]) * track.nx[k] + (car.z - track.pz[k]) * track.nz[k];
    console.log(`t=${(tick / 60).toFixed(2)} s=${car.trackS.toFixed(1)} v=${Math.hypot(car.vx, car.vz).toFixed(1)} vA=${vA.toFixed(1)} lat=${lat.toFixed(2)} line=${track.line.off[k].toFixed(2)} slip=${((car.slip * 180) / Math.PI).toFixed(1)} sl=${car.sliding} steer=${car.steer.toFixed(2)} w=${car.angVel.toFixed(2)}`);
  }
}
