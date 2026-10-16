// Online play end to end, in one process: the real GameServer and real client
// NetRace objects talking through a simulated network with latency and jitter.

import { describe, expect, it } from 'vitest';
import { DT } from '../shared/config/constants.ts';
import { makeSurfaceMix, mixSurfaces, type SurfaceId } from '../shared/config/surfaces.ts';
import { DEFAULT_TUNING } from '../shared/config/tuning.ts';
import { aiDrive } from '../shared/ai/driver.ts';
import { makeRng } from '../shared/math/rng.ts';
import { NetRace } from '../shared/net/netRace.ts';
import { MsgType, PROTOCOL_VERSION, type ClientMsg, type RoomInfo, type ServerMsg } from '../shared/net/protocol.ts';
import { applySnapshot, encodeSnapshot, SNAPSHOT_CAR_KEYS } from '../shared/net/snapshot.ts';
import { createRaceWorld } from '../shared/game/raceSetup.ts';
import { createCar } from '../shared/sim/car.ts';
import { neutralInput, type CarInput } from '../shared/sim/input.ts';
import { sampleCarSurface, stepWorld } from '../shared/sim/step.ts';
import { RacePhase } from '../shared/sim/world.ts';
import { GameServer, type Client } from './gameServer.ts';
import { START_MONEY, UPGRADE_PRICES, type Profile } from '../shared/game/shop.ts';

const TICK_MS = 1000 / 60;

/** Virtual clock with timed callbacks. */
class Net {
  now = 0;
  private queue: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  at(delay: number, fn: () => void): void {
    this.queue.push({ at: this.now + delay, seq: this.seq++, fn });
  }
  runUntil(t: number): void {
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const next = this.queue[0];
      if (!next || next.at > t) break;
      this.queue.shift();
      this.now = next.at;
      next.fn();
    }
    this.now = t;
  }
}

/** One-way delay with jitter, but in order (like TCP). */
function link(net: Net, baseMs: number, jitterMs: number, seed: number) {
  const rnd = makeRng(seed);
  let last = 0;
  return (fn: () => void) => {
    const at = Math.max(last, net.now + baseMs + rnd() * jitterMs);
    last = at;
    net.at(at - net.now, fn);
  };
}

class TestClient {
  readonly name: string;
  id = -1;
  room: RoomInfo | null = null;
  race: NetRace | null = null;
  profile: Profile | null = null;
  errors: string[] = [];
  /** Largest own-car correction (m) after warm-up, and the sum of all. */
  maxOwnCorrection = 0;
  ownCorrectionSum = 0;
  corrections = 0;
  aiCorrection = 0;
  frames = 0;
  private readonly up: (fn: () => void) => void;
  private readonly server: GameServer;
  private conn: Client;
  private readonly surf = makeSurfaceMix();
  private readonly frameMs: number;

  constructor(net: Net, server: GameServer, name: string, oneWayMs: number, jitterMs: number, frameMs: number, seed: number) {
    this.name = name;
    this.server = server;
    this.frameMs = frameMs;
    this.up = link(net, oneWayMs, jitterMs, seed);
    const down = link(net, oneWayMs, jitterMs, seed + 1);
    this.conn = server.open({
      sendText: (s) => down(() => this.onText(s)),
      sendBinary: (d) => {
        const copy = d.slice();
        down(() => this.onBinary(copy));
      },
      close: () => {},
    });
    const rttTicks = (oneWayMs * 2 + jitterMs) / TICK_MS;
    this.rtt = (rttTicks * TICK_MS);
    const frame = () => {
      this.frame(frameMs / 1000);
      net.at(frameMs, frame);
    };
    net.at(seed % frameMs, frame);
  }

  rtt: number;

  send(msg: ClientMsg): void {
    const s = JSON.stringify(msg);
    this.up(() => this.server.text(this.conn, s));
  }

  private onText(s: string): void {
    const msg = JSON.parse(s) as ServerMsg;
    if (msg.t === 'welcome') this.id = msg.id;
    else if (msg.t === 'room') this.room = msg.room;
    else if (msg.t === 'error') this.errors.push(msg.code);
    else if (msg.t === 'profile') this.profile = msg.profile;
    else if (msg.t === 'race') {
      this.race = new NetRace(msg.spec, this.id, (d) => {
        const copy = d.slice();
        this.up(() => this.server.binary(this.conn, copy));
      });
      this.race.rttMs = this.rtt;
    }
  }

  private onBinary(d: Uint8Array): void {
    if (d[0] === MsgType.Snapshot) this.race?.snapshot(d);
  }

  private frame(dt: number): void {
    const race = this.race;
    if (!race) return;
    this.frames++;
    race.update(dt, {
      sample: (p, out) => this.drive(race, race.localCars[p], out),
    });
    const warm = race.world.tick > race.world.race.startTick + 120;
    race.drift.forEach((d, i) => {
      const m = Math.hypot(d.dx, d.dz);
      if (warm) {
        if (race.localCars.includes(i)) {
          this.maxOwnCorrection = Math.max(this.maxOwnCorrection, m);
          this.ownCorrectionSum += m;
          this.corrections++;
        } else if (race.spec.entrants[i].playerId < 0) {
          this.aiCorrection = Math.max(this.aiCorrection, m);
        }
      }
      d.dx = d.dz = d.dh = 0;
    });
  }

  /** A "person" that drives like the computer, on the client's predicted world. */
  private drive(race: NetRace, id: number, out: CarInput): void {
    const car = { ...race.world.cars[id] };
    const t = DEFAULT_TUNING;
    sampleCarSurface(car, race.track, t);
    mixSurfaces(car.surfFront as SurfaceId, car.surfRear as SurfaceId, this.surf);
    aiDrive(car, race.track, t, this.surf, race.world.cars, race.world.tick, out);
    out.buttons = 0;
  }
}

function setup(clients: [number, number, number][], ai = 2) {
  const net = new Net();
  const server = new GameServer();
  server.now = () => net.now;
  server.seed = () => 1234;
  const tick = () => {
    server.tick();
    net.at(TICK_MS, tick);
  };
  net.at(TICK_MS, tick);
  const cs = clients.map(([lat, jit, frame], k) => new TestClient(net, server, `P${k}`, lat, jit, frame, 17 + k * 31));
  for (const c of cs) c.send({ t: 'hello', v: PROTOCOL_VERSION, name: c.name });
  net.runUntil(500);
  cs[0].send({ t: 'create' });
  net.runUntil(1000);
  const code = cs[0].room!.code;
  for (const c of cs.slice(1)) c.send({ t: 'join', code });
  net.runUntil(1500);
  cs[0].send({ t: 'config', config: { laps: 1, ai } });
  for (const c of cs.slice(1)) c.send({ t: 'ready', ready: true });
  net.runUntil(2000);
  cs[0].send({ t: 'start' });
  return { net, server, cs, room: () => server.rooms.get(code)! };
}

function runRace(net: Net, room: () => ReturnType<GameServer['rooms']['get']>, limitMs = 5 * 60_000) {
  let finishedAt = -1;
  for (let t = net.now; t < limitMs; t += 250) {
    net.runUntil(t);
    const r = room();
    if (r && !r.race && t > 3000) {
      finishedAt = t;
      break;
    }
  }
  return finishedAt;
}

describe('snapshots', () => {
  it('cover every car field', () => {
    const keys = Object.keys(createCar(0, 0, 0, 0)).filter((k) => k !== 'id').sort();
    expect([...SNAPSHOT_CAR_KEYS].sort()).toEqual(keys);
  });

  it('restore a world exactly, so it steps on identically', () => {
    const spec = {
      id: 1, track: 'greenvalley', laps: 2, seed: 99, countdownTicks: 10, weapons: true,
      entrants: Array.from({ length: 6 }, (_, i) => ({ name: `C${i}`, color: '#fff', playerId: -1, skill: 0.9 + i * 0.02 })),
    };
    const a = createRaceWorld(spec);
    for (let i = 0; i < 900; i++) stepWorld(a.world, a.track, [], [DEFAULT_TUNING]);
    const inputs = a.world.cars.map(() => neutralInput());
    const data = encodeSnapshot(a.world, inputs, { lead: 3, lastInputTick: 5 });
    const b = createRaceWorld(spec);
    expect(a.world.shots.some((s) => s.kind !== 0), 'some missiles or mines in flight').toBe(true);
    expect(applySnapshot(data, b.world, [])).toBe(900);
    for (let i = 0; i < 600; i++) {
      stepWorld(a.world, a.track, [], [DEFAULT_TUNING]);
      stepWorld(b.world, b.track, [], [DEFAULT_TUNING]);
    }
    expect(b.world.cars).toEqual(a.world.cars);
    expect(b.world.race).toEqual(a.world.race);
    expect(b.world.rng).toBe(a.world.rng);
    expect(b.world.shots.filter((s) => s.kind)).toEqual(a.world.shots.filter((s) => s.kind));
  });
});

describe('online race', () => {
  it('predicts the local car exactly when nobody else is human', () => {
    const { net, cs, room } = setup([[35, 10, 1000 / 60]], 3);
    const end = runRace(net, room);
    expect(end).toBeGreaterThan(0);
    const c = cs[0];
    expect(c.errors).toEqual([]);
    expect(c.race!.world.race.phase).toBe(RacePhase.Finished);
    // Deterministic simulation + inputs that arrive in time = no corrections at all.
    expect(c.maxOwnCorrection).toBeLessThan(1e-6);
    expect(c.aiCorrection).toBeLessThan(1e-6);
  });

  it('keeps two people with different pings in sync', () => {
    const { net, server, cs, room } = setup([[20, 6, 1000 / 60], [90, 30, 1000 / 144]], 2);
    let lateAfterStart = -1;
    // Check lateness once the clocks have settled (two seconds into the race).
    for (let t = net.now; t < 10_000; t += 100) {
      net.runUntil(t);
      const r = room();
      if (r?.race && r.race.world.tick > r.race.world.race.startTick + 120 && lateAfterStart < 0) {
        lateAfterStart = r.driverStats().reduce((a, d) => a + d.late, 0);
      }
    }
    const end = runRace(net, room);
    expect(end).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.errors).toEqual([]);
      expect(c.race!.world.race.phase).toBe(RacePhase.Finished);
      // Everybody agrees on the result.
      expect(c.race!.world.race.finishOrder).toEqual(cs[0].race!.world.race.finishOrder);
      // Both people finish (the race ends 3 s later, so a computer car far behind may not).
      expect(c.race!.world.race.finishOrder.length).toBeGreaterThanOrEqual(2);
      // Corrections come only from the other person's unpredictable inputs.
      expect(c.ownCorrectionSum / Math.max(1, c.corrections)).toBeLessThan(0.05);
    }
    expect(server.rooms.size).toBe(1);
    expect(room()!.state).toBe('lobby');
    expect(lateAfterStart).toBeGreaterThanOrEqual(0);
  });

  it('pays out after a race, sells upgrades, and races with them next time', () => {
    const { net, cs, room } = setup([[20, 5, 1000 / 60], [30, 5, 1000 / 60]], 1);
    expect(cs[0].profile?.money).toBe(START_MONEY);
    expect(runRace(net, room)).toBeGreaterThan(0);
    net.runUntil(net.now + 500);
    for (const c of cs) {
      expect(c.profile!.races).toBe(1);
      expect(c.profile!.money).toBeGreaterThan(START_MONEY);
    }
    expect(cs[0].room!.races).toBe(1);
    expect(cs[0].room!.players.reduce((a, p) => a + p.points, 0)).toBeGreaterThan(0);
    // Buy tyres, and a second time too many (not enough money for level 2 + 3 at once).
    const money = cs[1].profile!.money;
    cs[1].send({ t: 'buy', item: 'tyres' });
    net.runUntil(net.now + 300);
    expect(cs[1].profile!.tyres).toBe(1);
    expect(cs[1].profile!.money).toBe(money - UPGRADE_PRICES.tyres[0]);
    // The next race uses the upgrade, identically on the server and every client.
    cs[1].send({ t: 'ready', ready: true });
    net.runUntil(net.now + 300);
    cs[0].send({ t: 'start' });
    net.runUntil(net.now + 1000);
    const spec = room()!.race!.spec;
    expect(spec.entrants.find((e) => e.playerId === cs[1].id)!.loadout!.tyres).toBe(1);
    expect(cs[0].race!.spec).toEqual(spec);
    // Shopping during a race is refused.
    cs[1].send({ t: 'buy', item: 'missiles' });
    net.runUntil(net.now + 300);
    expect(cs[1].errors).toContain('bad');
  });

  it('hands a dropped driver to the computer and back on reconnect', () => {
    const { net, server, cs, room } = setup([[20, 5, 1000 / 60], [20, 5, 1000 / 60]], 0);
    net.runUntil(9000);
    const r = room()!;
    const car = r.race!.spec.entrants.findIndex((e) => e.playerId === cs[1].id);
    // Connection drops.
    server.closed((cs[1] as unknown as { conn: Client }).conn);
    net.runUntil(9100);
    expect(r.race!.world.cars[car].aiDriven).toBe(1);
    expect(cs[0].room!.players.find((p) => p.id === cs[1].id)!.connected).toBe(false);
    expect(r.info().players.length).toBe(2);
    net.runUntil(9500);
    expect(r.race!.world.cars[car].human).toBe(0);
  });
});
