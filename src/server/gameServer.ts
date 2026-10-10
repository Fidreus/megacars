// Connections, identities and rooms, independent of the socket library so
// tests can drive it directly. main.ts wires it to WebSockets.

import { randomBytes, randomInt } from 'node:crypto';
import {
  cleanCode, cleanName, CODE_ALPHABET, CODE_LENGTH, decodeInput, MsgType, PROTOCOL_VERSION,
  type ClientMsg, type ErrorCode, type PublicRoom, type ServerMsg,
} from '../shared/net/protocol.ts';
import { neutralInput } from '../shared/sim/input.ts';
import { isShopItem } from '../shared/game/shop.ts';
import { Room, type Peer } from './room.ts';

export interface Transport {
  sendText(s: string): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

export class Client implements Peer {
  readonly transport: Transport;
  id = -1;
  name = 'DRIVER';
  token = '';
  rtt = -1;
  room: Room | null = null;
  constructor(transport: Transport) {
    this.transport = transport;
  }
  get identified(): boolean {
    return this.id >= 0;
  }
  send(msg: ServerMsg): void {
    this.transport.sendText(JSON.stringify(msg));
  }
  sendBinary(data: Uint8Array): void {
    this.transport.sendBinary(data);
  }
  error(code: ErrorCode, msg: string): void {
    this.send({ t: 'error', code, msg });
  }
}

const MAX_ROOMS = 500;
/** Seats of dropped connections are kept this long (ms). */
export const RECONNECT_GRACE_MS = 60_000;

export class GameServer {
  readonly rooms = new Map<string, Room>();
  private readonly byToken = new Map<string, { id: number; code: string | null }>();
  /** Identified connections by player id. */
  private readonly live = new Map<number, Client>();
  private nextId = 1;
  private readonly scratch = neutralInput();
  /** Clock source (ms), replaceable in tests. */
  now: () => number = () => performance.now();
  /** Seed source for races, replaceable in tests. */
  seed: () => number = () => randomInt(0, 0x7fffffff);
  log: (msg: string) => void = () => {};

  open(transport: Transport): Client {
    return new Client(transport);
  }

  text(c: Client, raw: string): void {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw) as ClientMsg;
    } catch {
      c.error('bad', 'bad message');
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    if (msg.t === 'hello') {
      this.hello(c, msg);
      return;
    }
    if (!c.identified) return;
    switch (msg.t) {
      case 'create':
        this.createRoom(c, !!msg.public);
        break;
      case 'list':
        c.send({ t: 'rooms', rooms: this.publicRooms() });
        break;
      case 'quick': {
        // The fullest public room still waiting, then one racing (watch, then
        // race in the next one), else open a new public room and wait there.
        const open = [...this.rooms.values()]
          .filter((r) => r.config.public && r !== c.room && r.members.length < 8 && r.connectedCount > 0)
          .sort((a, b) => (a.state === b.state ? b.connectedCount - a.connectedCount : a.state === 'lobby' ? -1 : 1));
        if (open.length) {
          this.leaveRoom(c);
          this.enter(c, open[0]);
        } else {
          this.createRoom(c, true);
        }
        break;
      }
      case 'join': {
        const room = this.rooms.get(cleanCode(msg.code));
        if (!room) {
          c.error('noRoom', 'No room with that code');
          return;
        }
        if (room === c.room) {
          c.send({ t: 'room', room: room.info() });
          return;
        }
        if (room.members.length >= 8) {
          c.error('full', 'That room is full');
          return;
        }
        this.leaveRoom(c);
        this.enter(c, room);
        break;
      }
      case 'leave':
        this.leaveRoom(c);
        c.send({ t: 'left' });
        break;
      case 'name':
        c.name = cleanName(msg.name);
        c.room?.setName(c.id, c.name);
        break;
      case 'ready':
        c.room?.setReady(c.id, !!msg.ready);
        break;
      case 'config': {
        const err = c.room?.setConfig(c.id, msg.config ?? {});
        if (err) c.error(err, err === 'notHost' ? 'Only the host can change that' : 'Race in progress');
        break;
      }
      case 'buy': {
        if (!isShopItem(msg.item)) return;
        const err = c.room?.buy(c.id, msg.item);
        if (err) c.error('bad', err);
        break;
      }
      case 'newSeason': {
        const err = c.room?.newSeason(c.id);
        if (err) c.error(err, err === 'notHost' ? 'Only the host can start a new season' : 'Race in progress');
        break;
      }
      case 'start': {
        const err = c.room?.start(c.id, this.seed());
        if (err === 'bad') c.error('bad', 'Waiting for everybody to be ready');
        else if (err) c.error(err, err === 'notHost' ? 'Only the host can start' : 'Race in progress');
        break;
      }
    }
  }

  binary(c: Client, data: Uint8Array): void {
    if (data.byteLength < 1) return;
    if (data[0] === MsgType.Input) {
      if (!c.room) return;
      const tick = decodeInput(data, this.scratch);
      if (tick >= 0) c.room.input(c.id, tick, this.scratch);
    } else if (data[0] === MsgType.Ping && data.byteLength >= 9) {
      const out = new Uint8Array(17);
      out[0] = MsgType.Pong;
      out.set(data.subarray(1, 9), 1);
      new DataView(out.buffer).setFloat64(9, this.now(), true);
      c.sendBinary(out);
    }
  }

  closed(c: Client): void {
    if (this.live.get(c.id) === c) this.live.delete(c.id);
    if (!c.room) return;
    c.room.disconnect(c.id, this.now());
    c.room = null;
  }

  /** One 60 Hz tick for every racing room; public lobbies may start by themselves. */
  tick(): void {
    const now = this.now();
    for (const room of this.rooms.values()) {
      room.tick();
      if (room.config.public && room.autoStart(now, this.seed())) this.log(`room ${room.code} auto-started`);
    }
  }

  /** Public rooms anyone can join, waiting ones first. */
  publicRooms(): PublicRoom[] {
    return [...this.rooms.values()]
      .filter((r) => r.config.public && r.connectedCount > 0)
      .map((r) => r.listing())
      .sort((a, b) => (a.state === b.state ? b.players - a.players : a.state === 'lobby' ? -1 : 1))
      .slice(0, 30);
  }

  /** Expire dropped seats and empty rooms (call every few seconds). */
  sweep(): void {
    const now = this.now();
    for (const [code, room] of this.rooms) {
      room.expire(now, RECONNECT_GRACE_MS);
      if (room.isEmpty) {
        this.rooms.delete(code);
        this.log(`room ${code} closed`);
      }
    }
    for (const [token, who] of this.byToken) {
      if (who.code && !this.rooms.get(who.code)?.member(who.id)) who.code = null;
      if (!who.code && this.byToken.size > 5000) this.byToken.delete(token);
    }
  }

  /** Refresh pings shown in lobbies. */
  refreshLobbies(): void {
    for (const room of this.rooms.values()) if (room.state === 'lobby') room.broadcastRoom();
  }

  private hello(c: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void {
    if (msg.v !== PROTOCOL_VERSION) {
      c.error('version', 'The game has been updated. Reload the page.');
      c.transport.close(4000, 'version');
      return;
    }
    if (c.identified) return;
    c.name = cleanName(msg.name);
    const known = typeof msg.token === 'string' ? this.byToken.get(msg.token) : undefined;
    // A token already in use (a duplicated tab) gets a fresh identity.
    if (known && msg.token && !this.live.has(known.id)) {
      c.id = known.id;
      c.token = msg.token;
    } else {
      c.id = this.nextId++;
      c.token = randomBytes(12).toString('base64url');
      this.byToken.set(c.token, { id: c.id, code: null });
    }
    this.live.set(c.id, c);
    c.send({ t: 'welcome', id: c.id, token: c.token });
    // Back after a dropped connection: take the old seat again.
    const room = known?.code ? this.rooms.get(known.code) : undefined;
    if (room?.member(c.id)) {
      c.room = room;
      room.reconnect(c);
    }
  }

  private createRoom(c: Client, isPublic: boolean): void {
    if (this.rooms.size >= MAX_ROOMS) {
      c.error('limit', 'Server is full, try again later');
      return;
    }
    this.leaveRoom(c);
    const room = new Room(this.newCode());
    room.config.public = isPublic;
    this.rooms.set(room.code, room);
    this.enter(c, room);
    this.log(`${isPublic ? 'public' : 'private'} room ${room.code} created by ${c.name}`);
  }

  private enter(c: Client, room: Room): void {
    c.room = room;
    room.join(c);
    const who = this.byToken.get(c.token);
    if (who) who.code = room.code;
  }

  private leaveRoom(c: Client): void {
    if (!c.room) return;
    c.room.leave(c.id);
    if (c.room.isEmpty) this.rooms.delete(c.room.code);
    c.room = null;
    const who = this.byToken.get(c.token);
    if (who) who.code = null;
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
