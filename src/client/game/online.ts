// Online play on the client: the connection, the room we are in, and the
// race the server is running for it.

import { NetRace } from '../../shared/net/netRace.ts';
import { cleanName, MsgType, type RoomConfig, type RoomInfo, type ServerMsg } from '../../shared/net/protocol.ts';
import type { CarInput } from '../../shared/sim/input.ts';
import type { World } from '../../shared/sim/world.ts';
import type { Track } from '../../shared/track/types.ts';
import { Connection, type ConnState } from '../net/connection.ts';
import type { GameSession } from './session.ts';

const NAME_KEY = 'megacars.name';

/** A race on the server, as this client sees and drives it. */
export class OnlineSession implements GameSession {
  readonly net: NetRace;
  readonly track: Track;
  readonly world: World;
  readonly inputs: readonly CarInput[];
  readonly playerCars: readonly number[];
  readonly names: readonly string[];
  readonly colors: readonly string[];

  constructor(net: NetRace) {
    this.net = net;
    this.track = net.track;
    this.world = net.world;
    this.inputs = net.predictor.inputs;
    this.playerCars = net.localCars;
    this.names = net.names;
    this.colors = net.colors;
  }
}

export interface OnlineEvents {
  /** A race started (or we joined one in progress). */
  race(s: OnlineSession): void;
  /** Room info changed (or we left the room: null). */
  room(room: RoomInfo | null): void;
  /** Something to tell the player. */
  notice(text: string): void;
}

export class Online {
  readonly conn: Connection;
  room: RoomInfo | null = null;
  race: OnlineSession | null = null;
  /** Room code being typed on the join screen. */
  code = '';
  private pending: { t: 'create' } | { t: 'join'; code: string } | null = null;
  private readonly events: OnlineEvents;

  constructor(events: OnlineEvents) {
    this.events = events;
    this.conn = new Connection(loadName(), {
      message: (m) => this.onMessage(m),
      binary: (d) => {
        if (d[0] === MsgType.Snapshot) this.race?.net.snapshot(d);
      },
      state: (s) => this.onState(s),
    });
  }

  get name(): string {
    return this.conn.name;
  }

  set name(v: string) {
    this.conn.name = v;
  }

  /** Store a finished name edit and tell the server. */
  commitName(): void {
    this.conn.name = cleanName(this.conn.name);
    try {
      localStorage.setItem(NAME_KEY, this.conn.name);
    } catch {
      // Not remembered, that's all.
    }
    this.conn.send({ t: 'name', name: this.conn.name });
  }

  get state(): ConnState {
    return this.conn.state;
  }

  get me(): number {
    return this.conn.id;
  }

  get isHost(): boolean {
    return !!this.room && this.room.hostId === this.conn.id;
  }

  get myInfo() {
    return this.room?.players.find((p) => p.id === this.conn.id);
  }

  connect(): void {
    this.conn.connect();
  }

  create(): void {
    this.request({ t: 'create' });
  }

  join(code: string): void {
    this.request({ t: 'join', code });
  }

  leave(): void {
    this.pending = null;
    this.conn.send({ t: 'leave' });
    this.setRoom(null);
    this.race = null;
  }

  setReady(ready: boolean): void {
    this.conn.send({ t: 'ready', ready });
  }

  configure(c: Partial<RoomConfig>): void {
    this.conn.send({ t: 'config', config: c });
  }

  start(): void {
    this.conn.send({ t: 'start' });
  }

  /** Per frame: keep the race clock informed about the round trip. */
  update(): void {
    if (this.race && this.conn.rtt > 0) this.race.net.rttMs = this.conn.rtt;
  }

  private request(msg: { t: 'create' } | { t: 'join'; code: string }): void {
    this.pending = msg;
    this.connect();
    if (this.conn.online) this.flush();
  }

  private flush(): void {
    if (!this.pending) return;
    this.conn.send(this.pending);
    this.pending = null;
  }

  private setRoom(room: RoomInfo | null): void {
    this.room = room;
    this.events.room(room);
  }

  private onState(s: ConnState): void {
    if (s === 'open') this.flush();
    else if (s === 'retrying') this.events.notice('CONNECTION LOST - RECONNECTING');
    else if (s === 'failed') this.events.notice('CANNOT REACH THE SERVER');
  }

  private onMessage(msg: ServerMsg): void {
    switch (msg.t) {
      case 'welcome':
        this.flush();
        break;
      case 'room':
        this.setRoom(msg.room);
        break;
      case 'left':
        this.setRoom(null);
        break;
      case 'race': {
        if (this.race && this.race.net.spec.id === msg.spec.id) {
          // Back after a reconnect: same race, carry on with fresh snapshots.
          break;
        }
        const net = new NetRace(msg.spec, this.conn.id, (d) => this.conn.sendBinary(d));
        if (this.conn.rtt > 0) net.rttMs = this.conn.rtt;
        this.race = new OnlineSession(net);
        this.events.race(this.race);
        break;
      }
      case 'raceOver':
        break;
      case 'error':
        this.events.notice(msg.msg.toUpperCase());
        break;
    }
  }
}

function loadName(): string {
  try {
    const saved = localStorage.getItem(NAME_KEY);
    if (saved) return cleanName(saved);
  } catch {
    // Fall through to a made-up name.
  }
  return `DRIVER ${Math.floor(10 + Math.random() * 90)}`;
}
