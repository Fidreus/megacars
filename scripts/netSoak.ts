// Headless online clients against a running server over real WebSockets:
// create a room, race with N bots driving like people, report sync health.
//   node scripts/netSoak.ts --url ws://localhost:8787/ws --clients 3 --laps 1 --track dustbowl

import { parseArgs } from 'node:util';
import WebSocket from 'ws';
import { makeSurfaceMix, mixSurfaces, type SurfaceId } from '../src/shared/config/surfaces.ts';
import { DEFAULT_TUNING } from '../src/shared/config/tuning.ts';
import { aiDrive } from '../src/shared/ai/driver.ts';
import { NetRace } from '../src/shared/net/netRace.ts';
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
  },
});

class Bot {
  ws: WebSocket;
  id = -1;
  room: RoomInfo | null = null;
  race: NetRace | null = null;
  rtt = 50;
  maxOwn = 0;
  sumOwn = 0;
  n = 0;
  leads: number[] = [];
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
        this.ws.send(b);
      }, 1000);
    });
    this.ws.on('message', (d: Buffer, bin) => {
      if (!bin) return this.onMsg(JSON.parse(String(d)) as ServerMsg);
      const u = new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
      if (u[0] === MsgType.Pong) this.rtt = this.rtt * 0.8 + (performance.now() - d.readDoubleLE(1)) * 0.2;
      else if (u[0] === MsgType.Snapshot) this.race?.snapshot(u.slice());
    });
    setInterval(() => this.frame(), 1000 / 60);
  }
  send(m: ClientMsg) {
    this.ws.send(JSON.stringify(m));
  }
  onMsg(m: ServerMsg) {
    if (m.t === 'welcome') this.id = m.id;
    else if (m.t === 'room') this.room = m.room;
    else if (m.t === 'race') this.race = new NetRace(m.spec, this.id, (d) => this.ws.send(d));
    else if (m.t === 'error') console.log(this.name, 'error', m.msg);
  }
  frame() {
    const now = performance.now();
    const dt = (now - this.last) / 1000;
    this.last = now;
    const race = this.race;
    if (!race) return;
    race.rttMs = this.rtt;
    race.update(dt, {
      sample: (p, out) => {
        const car = { ...race.world.cars[race.localCars[p]] };
        sampleCarSurface(car, race.track, DEFAULT_TUNING);
        mixSurfaces(car.surfFront as SurfaceId, car.surfRear as SurfaceId, this.surf);
        aiDrive(car, race.track, DEFAULT_TUNING, this.surf, race.world.cars, out);
        out.buttons = 0;
      },
      corrected: (drift) => {
        if (race.world.tick < race.world.race.startTick + 120) return;
        for (const i of race.localCars) {
          const m = Math.hypot(drift[i].dx, drift[i].dz);
          this.maxOwn = Math.max(this.maxOwn, m);
          this.sumOwn += m;
          this.n++;
        }
        this.leads.push(race.predictor.lead);
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
bots[0].send({ t: 'config', config: { laps: Number(values.laps), ai: Number(values.ai), track: values.track, weapons: true } });
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
      `own corr avg ${(b.sumOwn / Math.max(1, b.n)).toFixed(4)} max ${b.maxOwn.toFixed(3)} m`,
  );
}
process.exit(0);
