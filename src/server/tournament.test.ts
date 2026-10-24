// Tournaments: the host picks several tracks (player tracks too), the room
// races them in turn and the points add up; a new one starts after the last.

import { describe, expect, it, vi } from 'vitest';
import { Surface } from '../shared/config/surfaces.ts';
import { PROTOCOL_VERSION, type RoomInfo, type ServerMsg } from '../shared/net/protocol.ts';
import { canonicalDef, encodeTrack } from '../shared/track/custom.ts';
import type { TrackDef } from '../shared/track/types.ts';
import { GameServer, type Client } from './gameServer.ts';

const RECT: TrackDef = canonicalDef({
  id: 'draft', name: 'Test oval', theme: 'countryside', width: 18, runoff: 5, startAt: 0.5, laps: 3, seed: 7,
  path: [{ x: 300, z: 0, r: 40 }, { x: 300, z: 220, r: 40 }, { x: -300, z: 220, r: 40 }, { x: -300, z: 0, r: 40 }],
  patches: [{ surface: Surface.Gravel, x: 290, z: 210, r: 20, runoff: true }],
});

class Fake {
  room: RoomInfo | null = null;
  defs: Record<string, string> = {};
  errors: string[] = [];
  races: string[] = [];
  /** Message kinds in arrival order. */
  log: string[] = [];
  readonly c: Client;
  readonly server: GameServer;
  constructor(server: GameServer, name: string) {
    this.server = server;
    this.c = server.open({
      sendText: (s) => {
        const m = JSON.parse(s) as ServerMsg;
        this.log.push(m.t);
        if (m.t === 'room') this.room = m.room;
        if (m.t === 'trackDefs') this.defs = m.defs;
        if (m.t === 'error') this.errors.push(m.msg);
        if (m.t === 'race') this.races.push(m.spec.track);
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

describe('tournaments', () => {
  it('races a player track and a game track in turn, then starts over', { timeout: 30_000 }, async () => {
    const server = new GameServer();
    const host = new Fake(server, 'HOST');
    host.send({ t: 'create' });
    const code = encodeTrack(RECT);
    host.send({ t: 'trackDef', code });
    // Checked and built in the worker thread.
    await vi.waitFor(() => expect(host.defs[RECT.id]).toBe(code), { timeout: 20_000, interval: 50 });
    host.send({ t: 'config', config: { tour: [RECT.id, 'tivoli', 'nope'], laps: 1, ai: 1 } });
    expect(host.room!.config.tour).toEqual([RECT.id, 'tivoli']);
    expect(host.room!.tourNames).toEqual(['TEST OVAL', 'Tivoli Twist']);

    // Someone joining gets the player track before the room that uses it.
    const guest = new Fake(server, 'GUEST');
    guest.send({ t: 'join', code: host.room!.code });
    expect(guest.defs[RECT.id]).toBe(code);
    expect(guest.log.indexOf('trackDefs')).toBeLessThan(guest.log.indexOf('room'));
    guest.send({ t: 'ready', ready: true });

    const room = server.rooms.get(host.room!.code)!;
    host.send({ t: 'start' });
    expect(guest.races).toEqual([RECT.id]);
    room.endRace();
    expect(host.room!.tourIndex).toBe(1);
    expect(host.room!.config.track).toBe('tivoli');
    guest.send({ t: 'ready', ready: true });
    host.send({ t: 'start' });
    expect(guest.races).toEqual([RECT.id, 'tivoli']);
    room.endRace();
    expect(host.room!.tourIndex).toBe(2);
    expect(server.publicRooms()).toEqual([]);
    // Over: the next START is race one of a new tournament.
    guest.send({ t: 'ready', ready: true });
    host.send({ t: 'start' });
    expect(guest.races).toEqual([RECT.id, 'tivoli', RECT.id]);
    expect(host.room!.tourIndex).toBe(0);
    server.tracks.stop();
  });

  it('turns away broken tracks and tracks from anyone but the host', { timeout: 30_000 }, async () => {
    const server = new GameServer();
    const host = new Fake(server, 'HOST');
    host.send({ t: 'create' });
    const guest = new Fake(server, 'GUEST');
    guest.send({ t: 'join', code: host.room!.code });
    guest.send({ t: 'trackDef', code: encodeTrack(RECT) });
    expect(guest.errors.at(-1)).toMatch(/host/i);
    host.send({ t: 'trackDef', code: 'x'.repeat(5000) });
    host.send({ t: 'trackDef', code: 'not a track' });
    expect(host.errors.at(-1)).toMatch(/not a track/i);
    // Corners that don't fit: the server's check says no and it leaves the tournament.
    const bad = canonicalDef({ ...RECT, name: 'Broken', path: [{ x: 30, z: 0, r: 80 }, { x: 30, z: 40, r: 80 }, { x: -30, z: 40, r: 80 }] });
    host.send({ t: 'trackDef', code: encodeTrack(bad) });
    host.send({ t: 'config', config: { tour: [bad.id, 'tivoli'] } });
    expect(host.room!.config.tour).toEqual([bad.id, 'tivoli']);
    await vi.waitFor(() => expect(host.errors.at(-1)).toMatch(/^BROKEN: /), { timeout: 20_000, interval: 50 });
    expect(host.room!.config.tour).toEqual(['tivoli']);
    expect(host.defs[bad.id]).toBeUndefined();
    server.tracks.stop();
  });

  it('public rooms race a few random game tracks', () => {
    const server = new GameServer();
    const a = new Fake(server, 'ANNA');
    a.send({ t: 'create', public: true });
    expect(a.room!.config.tour.length).toBe(3);
    expect(new Set(a.room!.config.tour).size).toBe(3);
    expect(server.publicRooms()[0]).toMatchObject({ tour: 3, tourIndex: 0, trackName: a.room!.tourNames[0] });
  });
});
