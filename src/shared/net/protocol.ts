// Wire protocol. Binary messages (inputs, snapshots, pings) start with a
// one-byte type; lobby and control messages are JSON in text frames.

import { SIM_VERSION } from '../config/constants.ts';
import type { CarInput } from '../sim/input.ts';

/** Bump when messages change incompatibly. Clients and server must match. */
export const PROTOCOL_VERSION = 1 + SIM_VERSION * 100;

export const MsgType = {
  Input: 1,
  Ping: 2,
  Snapshot: 3,
  Pong: 4,
} as const;

export const MAX_PLAYERS = 8;
export const NAME_MAX = 12;
/** Room codes: letters that cannot be mistaken for each other. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_LENGTH = 4;
/** The server sends a snapshot every this many ticks (20 per second). */
export const SNAPSHOT_EVERY = 3;

// ------------------------------------------------------------------ inputs

export const INPUT_SIZE = 9;

export function encodeInput(tick: number, i: CarInput, out = new Uint8Array(INPUT_SIZE)): Uint8Array {
  const v = new DataView(out.buffer, out.byteOffset, INPUT_SIZE);
  v.setUint8(0, MsgType.Input);
  v.setUint32(1, tick, true);
  v.setInt8(5, Math.round(i.steer * 127));
  v.setUint8(6, Math.round(i.throttle * 255));
  v.setUint8(7, Math.round(i.brake * 255));
  v.setUint8(8, i.buttons & 0xff);
  return out;
}

/** Returns the input's tick, or -1 for malformed data. */
export function decodeInput(data: Uint8Array, out: CarInput): number {
  if (data.byteLength !== INPUT_SIZE || data[0] !== MsgType.Input) return -1;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  out.steer = Math.max(-1, v.getInt8(5) / 127);
  out.throttle = v.getUint8(6) / 255;
  out.brake = v.getUint8(7) / 255;
  out.buttons = v.getUint8(8);
  return v.getUint32(1, true);
}

// ------------------------------------------------------------------- lobby

export interface RoomConfig {
  track: string;
  laps: number;
  /** Computer cars added to the people. */
  ai: number;
  difficulty: number;
}

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  /** Round-trip time in ms (-1 = unknown). */
  ping: number;
}

export interface RoomInfo {
  code: string;
  hostId: number;
  players: PlayerInfo[];
  config: RoomConfig;
  /** 'race' while a race runs (newcomers spectate until the next one). */
  state: 'lobby' | 'race';
}

export interface Entrant {
  name: string;
  color: string;
  /** Player id driving this car, or -1 for a computer driver. */
  playerId: number;
  /** AI skill (also used when a person drops out mid-race). */
  skill: number;
}

/** Everything needed to build the same starting world everywhere. */
export interface RaceSpec {
  id: number;
  track: string;
  laps: number;
  seed: number;
  countdownTicks: number;
  entrants: Entrant[];
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; token?: string }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'name'; name: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'config'; config: Partial<RoomConfig> }
  | { t: 'start' };

export type ServerMsg =
  | { t: 'welcome'; id: number; token: string }
  | { t: 'error'; code: ErrorCode; msg: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'left' }
  /** A race starts (or is running, for newcomers). `tick` is the server's world tick now. */
  | { t: 'race'; spec: RaceSpec; tick: number }
  /** The race is over; the room is back in the lobby. */
  | { t: 'raceOver' };

export type ErrorCode = 'version' | 'noRoom' | 'full' | 'busy' | 'notHost' | 'bad' | 'limit';

export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9 ._-]/g, '').trim().slice(0, NAME_MAX);
  return s || 'DRIVER';
}

export function cleanCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}
