// Wire protocol. Binary messages (inputs, snapshots, pings) start with a
// one-byte type; lobby and control messages are JSON in text frames.

import { SIM_VERSION } from '../config/constants.ts';
import type { CarInput } from '../sim/input.ts';
import type { League } from '../game/leagues.ts';
import type { Loadout, Profile, ShopItem } from '../game/shop.ts';

/** Bump when messages change incompatibly. Clients and server must match. */
// The +3: tournaments and player tracks in rooms.
export const PROTOCOL_VERSION = 3 + SIM_VERSION * 100;

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
/** Ticks over which the server reports the smallest input lead (the client's feedback lags by this much). */
export const LEAD_WINDOW = 30;

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

/** Most races in one tournament. */
export const TOUR_MAX = 12;
/** Player tracks a room keeps at once. */
export const ROOM_TRACKS_MAX = 12;

export interface RoomConfig {
  /** The track of the next race (the tournament's current one). */
  track: string;
  /** The tournament: its tracks in order (one = a single race at a time). */
  tour: string[];
  laps: number;
  /** Computer cars added to the people. */
  ai: number;
  difficulty: number;
  /** Missiles, mines, turbo and damage. */
  weapons: boolean;
  /** Prize money, the shop and upgrades carried between races. */
  upgrades: boolean;
  /** Listed for anyone to join (otherwise only with the code). */
  public: boolean;
  /** Car class. */
  league: League;
  /** Damage wears the car (otherwise a wreck's tow is the only cost). */
  damageSlows: boolean;
}

/** A public room in the room list. */
export interface PublicRoom {
  code: string;
  host: string;
  players: number;
  track: string;
  /** The track's name (it may be a player track the list doesn't know). */
  trackName: string;
  /** Tournament: races in it, and the one that is next (0-based). */
  tour: number;
  tourIndex: number;
  laps: number;
  weapons: boolean;
  upgrades: boolean;
  state: 'lobby' | 'race';
}

/** Public rooms start by themselves this long after everybody is ready (ms). */
export const AUTO_START_MS = 5000;

export interface PlayerInfo {
  id: number;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  /** Round-trip time in ms (-1 = unknown). */
  ping: number;
  /** Season points and the latest race's place (0 = none). */
  points: number;
  lastPlace: number;
}

export interface RoomInfo {
  code: string;
  hostId: number;
  players: PlayerInfo[];
  config: RoomConfig;
  /** 'race' while a race runs (newcomers spectate until the next one). */
  state: 'lobby' | 'race';
  /** Races run this season. */
  races: number;
  /** Races of the tournament already run (equal to its length when it is over). */
  tourIndex: number;
  /** Names of the tournament's tracks (player tracks included). */
  tourNames: string[];
  /** Public rooms: seconds until the race starts by itself (0 = not counting down). */
  startsIn: number;
}

export interface Entrant {
  name: string;
  color: string;
  /** Player id driving this car, or -1 for a computer driver. */
  playerId: number;
  /** AI skill (also used when a person drops out mid-race). */
  skill: number;
  /** Upgrades, ammo and damage (default: stock car, standard ammo). */
  loadout?: Loadout;
}

/** Everything needed to build the same starting world everywhere. */
export interface RaceSpec {
  id: number;
  track: string;
  laps: number;
  seed: number;
  countdownTicks: number;
  weapons: boolean;
  entrants: Entrant[];
  /** Car class (absent = standard). */
  league?: League;
  /** false = damage doesn't wear the car, only wrecks cost time (absent = it does). */
  damageSlows?: boolean;
}

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; token?: string }
  | { t: 'create'; public?: boolean }
  /** The public rooms, please. */
  | { t: 'list' }
  /** Join the best public room waiting for players (or open a new one). */
  | { t: 'quick' }
  | { t: 'join'; code: string }
  | { t: 'leave' }
  | { t: 'name'; name: string }
  | { t: 'ready'; ready: boolean }
  | { t: 'config'; config: Partial<RoomConfig> }
  | { t: 'start' }
  | { t: 'buy'; item: ShopItem }
  | { t: 'newSeason' }
  /** Host: a player track for the tournament (a share code; checked by the server). */
  | { t: 'trackDef'; code: string };

export type ServerMsg =
  | { t: 'welcome'; id: number; token: string }
  | { t: 'error'; code: ErrorCode; msg: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'rooms'; rooms: PublicRoom[] }
  | { t: 'left' }
  /** A race starts (or is running, for newcomers). `tick` is the server's world tick now. */
  | { t: 'race'; spec: RaceSpec; tick: number }
  /** The race is over; the room is back in the lobby. */
  | { t: 'raceOver' }
  /** Your own season profile (money, upgrades, ammo, damage). */
  | { t: 'profile'; profile: Profile }
  /** The room's player tracks (id -> share code), sent before they are used. */
  | { t: 'trackDefs'; defs: Record<string, string> };

export type ErrorCode = 'version' | 'noRoom' | 'full' | 'busy' | 'notHost' | 'bad' | 'limit';

export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9 ._-]/g, '').trim().slice(0, NAME_MAX);
  return s || 'DRIVER';
}

export function cleanCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}
