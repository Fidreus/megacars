// Public rooms: the room list, quick match and starting by themselves.

import { describe, expect, it } from 'vitest';
import { AUTO_START_MS, PROTOCOL_VERSION, type PublicRoom, type RoomInfo, type ServerMsg } from '../shared/net/protocol.ts';
import { GameServer, type Client } from './gameServer.ts';

class Fake {
  room: RoomInfo | null = null;
  rooms: PublicRoom[] = [];
  raced = false;
  readonly c: Client;
  readonly server: GameServer;
  constructor(server: GameServer, name: string) {
    this.server = server;
    this.c = server.open({
      sendText: (s) => {
        const m = JSON.parse(s) as ServerMsg;
        if (m.t === 'room') this.room = m.room;
        if (m.t === 'rooms') this.rooms = m.rooms;
        if (m.t === 'race') this.raced = true;
      },
      sendBinary: () => {},
      close: () => {},
    });
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name });
  }
  send(m: object): void {
    this.server.text(this.c, JSON.stringify(m));
  }
}

function setup() {
  const server = new GameServer();
  let now = 0;
  server.now = () => now;
  return { server, advance: (ms: number) => { for (let t = 0; t < ms; t += 50) { now += 50; server.tick(); } } };
}

describe('public rooms', () => {
  it('lists public rooms only, and quick match joins the fullest waiting one', () => {
    const { server } = setup();
    const a = new Fake(server, 'ANNA');
    const b = new Fake(server, 'BO');
    a.send({ t: 'create', public: true });
    b.send({ t: 'create' });
    const c = new Fake(server, 'CILLA');
    c.send({ t: 'list' });
    expect(c.rooms.map((r) => r.code)).toEqual([a.room!.code]);
    expect(c.rooms[0]).toMatchObject({ host: 'ANNA', players: 1, state: 'lobby' });
    c.send({ t: 'quick' });
    expect(c.room?.code).toBe(a.room!.code);
    expect(c.room?.config.public).toBe(true);
    // Nothing public with room left: quick match opens a new public room.
    const d = new Fake(server, 'DAN');
    b.send({ t: 'config', config: { public: true } });
    b.send({ t: 'leave' });
    d.send({ t: 'quick' });
    expect(d.room?.code).toBe(a.room!.code);
  });

  it('starts by itself once everybody in a public room is ready', () => {
    const { server, advance } = setup();
    const a = new Fake(server, 'ANNA');
    a.send({ t: 'create', public: true });
    const b = new Fake(server, 'BO');
    b.send({ t: 'quick' });
    a.send({ t: 'ready', ready: true });
    advance(1000);
    expect(a.room?.startsIn).toBe(0);
    b.send({ t: 'ready', ready: true });
    advance(200);
    expect(a.room!.startsIn).toBeGreaterThan(0);
    // Somebody changes their mind: the countdown stops.
    b.send({ t: 'ready', ready: false });
    advance(AUTO_START_MS + 500);
    expect(a.raced).toBe(false);
    b.send({ t: 'ready', ready: true });
    advance(AUTO_START_MS + 500);
    expect(a.raced && b.raced).toBe(true);
    expect(a.room?.state).toBe('race');
  });

  it('private rooms never start by themselves', () => {
    const { server, advance } = setup();
    const a = new Fake(server, 'ANNA');
    a.send({ t: 'create' });
    const b = new Fake(server, 'BO');
    b.send({ t: 'join', code: a.room!.code });
    a.send({ t: 'ready', ready: true });
    b.send({ t: 'ready', ready: true });
    advance(AUTO_START_MS * 2);
    expect(a.raced).toBe(false);
  });
});
