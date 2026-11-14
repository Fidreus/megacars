// Headless online clients against a running server over real WebSockets:
// create a room, race with N bots driving like people, report sync health.
//   node scripts/netSoak.ts --url ws://localhost:8787/ws --clients 3 --laps 1 --track dustbowl [--weather rain|changing] [--elimination]
// Bad networks: --lag 60 --jitter 40 --loss 0.02 (one-way ms; a lost TCP
// packet holds everything behind it for a retransmit, ~200 ms).
// Slow devices: --hitch 150 --hitchEvery 90 (a frame that blocks for 150 ms
// every 90 frames) and --clamp 0.1 (longest frame step, like the browser game
// used to). DEBUG_JUMPS=1 logs the first snapshots' sync and every clock jump.

import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { makeSurfaceMix, mixSurfaces, type SurfaceId } from '../src/shared/config/surfaces.ts';
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { aiDrive } from '../src/shared/ai/driver.ts';
import { NetRace } from '../src/shared/net/netRace.ts';
import { leagueOf } from '../src/shared/game/leagues.ts';
import { weatherChoiceOf } from '../src/shared/game/weather.ts';
import { MsgType, PROTOCOL_VERSION, type ClientMsg, type RoomInfo, type ServerMsg } from '../src/shared/net/protocol.ts';
import { sampleCarSurface } from '../src/shared/sim/step.ts';
import { RacePhase } from '../src/shared/sim/world.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'ws://localhost:8787/ws' },
    clients: { type: 'string', default: '2' },
    laps: { type: 'string', default: '1' },
    ai: { type: 'string', default: '2' },
    track: { type: 'string', default: 'greenvalley' },
    league: { type: 'string', default: 'standard' },
    weather: { type: 'string', default: 'dry' },
    elimination: { type: 'boolean', default: false },
    lag: { type: 'string', default: '0' },
    jitter: { type: 'string', default: '0' },
    loss: { type: 'string', default: '0' },
    hitch: { type: 'string', default: '0' },
    hitchEvery: { type: 'string', default: '90' },
    clamp: { type: 'string', default: '1' },
  },
});

const LAG = Number(values.lag);
const JITTER = Number(values.jitter);
const LOSS = Number(values.loss);
const HITCH = Number(values.hitch);
const HITCH_EVERY = Number(values.hitchEvery);
const CLAMP = Number(values.clamp);

/** In-order delivery with lag, jitter and retransmit stalls, like TCP on a bad line. */
class Pipe {
  private at = 0;
  deliver(f: () => void): void {
    if (LAG === 0 && JITTER === 0 && LOSS === 0) return f();
    const now = performance.now();
    let t = now + LAG + Math.random() * JITTER;
    if (Math.random() < LOSS) t += 200;
    this.at = Math.max(this.at, t);
    setTimeout(f, this.at - now);
  }
}

class Bot {
  private readonly up = new Pipe();
  private readonly down = new Pipe();
  ws: WebSocket;
  id = -1;
  room: RoomInfo | null = null;
  race: NetRace | null = null;
  rtt = 50;
  maxOwn = 0;
  /** Corrections of the own car big enough to see (> 0.3 m). */
  jumps = 0;
  sumOwn = 0;
  n = 0;
  leads: number[] = [];
  late = 0;
  private surf = makeSurfaceMix();
  private last = performance.now();
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    this.ws = new WebSocket(values.url);
    this.ws.binaryType = 'nodebuffer';
    this.ws.on('open', () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name });
      setInterval(() => {
        const b = Buffer.alloc(9);
        b[0] = MsgType.Ping;
        b.writeDoubleLE(performance.now(), 1);
        this.up.deliver(() => this.ws.send(b));
      }, 1000);
    });
    this.ws.on('message', (d: Buffer, bin) => this.down.deliver(() => this.receive(d, bin)));
    setInterval(() => this.frame(), 1000 / 60);
  }
  receive(d: Buffer, bin: boolean) {
    {
      if (!bin) return this.onMsg(JSON.parse(String(d)) as ServerMsg);
      const u = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      if (u[0] === MsgType.Pong) this.rtt = this.rtt * 0.8 + (performance.now() - d.readDoubleLE(1)) * 0.2;
      else if (u[0] === MsgType.Snapshot) this.race?.snapshot(u.slice());
    }
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  onMsg(m: ServerMsg) {
    if (m.t === 'welcome') this.id = m.id;
    else if (m.t === 'room') this.room = m.room;
    else if (m.t === 'race') {
      this.race = new NetRace(m.spec, this.id, (d) => { const c = d.slice(); this.up.deliver(() => this.ws.send(c)); });
      if (process.env.DEBUG_JUMPS) {
        const lc = this.race.lead;
        const orig = lc.update.bind(lc);
        const race = this.race;
        let shown = 0;
        lc.update = (lead: number, rtt: number) => {
          const r = orig(lead, rtt);
          if (shown++ < 25) console.log(this.name, 'snap server', race.predictor.serverTick, 'client', race.world.tick, 'lead', lead, 'target', lc.target, 'rate', r.toFixed(3), 'rtt', rtt.toFixed(1));
          if (lc.jump !== 0) console.log(this.name, 'tick', race.world.tick, 'start', race.world.race.startTick, 'lead', lead, 'target', lc.target, 'jump', lc.jump);
          return r;
        };
      }
    }
    else if (m.t === 'error') console.log(this.name, 'error', m.msg);
  }
  private frames = 0;
  frame() {
    if (HITCH > 0 && ++this.frames % HITCH_EVERY === 0) {
      // A slow frame: the whole thread is busy (garbage collection, a big draw).
      const until = performance.now() + HITCH;
      while (performance.now() < until);
    }
    const now = performance.now();
    const dt = Math.min(CLAMP, (now - this.last) / 1000);
    this.last = now;
    const race = this.race;
    if (!race) return;
    race.rttMs = this.rtt;
    race.update(dt, {
      sample: (p, out) => {
        const car = { ...race.world.cars[race.localCars[p]] };
        sampleCarSurface(car, race.track, DEFAULT_TUNING);
        mixSurfaces(car.surfFront as SurfaceId, car.surfRear as SurfaceId, this.surf);
        aiDrive(car, race.track, DEFAULT_TUNING, this.surf, race.world.cars, race.world.tick, out);
        out.buttons = 0;
      },
      corrected: () => {
        if (race.world.tick < race.world.race.startTick + 120) return;
        this.leads.push(race.predictor.lead);
        if (race.predictor.lead < 0) this.late++;
      },
    });
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const bots = Array.from({ length: Number(values.clients) }, (_, i) => new Bot(`BOT${i + 1}`));
await sleep(800);
bots[0].send({ t: 'create' });
while (!bots[0].room) await sleep(50);
for (const b of bots.slice(1)) b.send({ t: 'join', code: bots[0].room.code });
await sleep(500);
bots[0].send({ t: 'config', config: { laps: Number(values.laps), ai: Number(values.ai), track: values.track, weapons: true, league: leagueOf(values.league), weather: weatherChoiceOf(values.weather), ...(values.elimination ? { mode: 'elimination' as const } : {}) } });
for (const b of bots.slice(1)) b.send({ t: 'ready', ready: true });
await sleep(500);
bots[0].send({ t: 'start' });
const t0 = performance.now();
while (!bots.every((b) => b.race && b.race.world.race.phase === RacePhase.Finished)) {
  await sleep(1000);
  if (performance.now() - t0 > 5 * 60_000) {
    console.log('timeout');
    break;
  }
}
for (const b of bots) {
  const r = b.race!;
  const leads = b.leads.slice(-200);
  console.log(
    `${b.name} rtt ${b.rtt.toFixed(1)}ms finish ${JSON.stringify(r.world.race.finishOrder)} ` +
      `lead min/avg ${Math.min(...leads)}/${(leads.reduce((a, c) => a + c, 0) / leads.length).toFixed(1)} ` +
      `own corr avg ${(r.stats.fixMetres / Math.max(1, r.stats.fixes)).toFixed(4)} max ${r.stats.worstFix.toFixed(3)} m, visible jumps ${r.stats.bigFixes} ` +
        `(late inputs ${b.late}, clock jumps ${r.stats.jumps})`,
  );
}
process.exit(0);
