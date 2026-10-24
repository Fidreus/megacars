// Player-made tracks: a canonical form (rounded, limited, with an id that is
// a hash of the content), a compact share code that fits in a link and in
// one network message, and the checks a track must pass to be driven,
// raced online or published.

import { Surface, type SurfaceId } from '../config/surfaces.ts';
import { buildTrack } from './builder.ts';
import type { PathPoint, RampDef, SurfacePatch, Track, TrackDef } from './types.ts';
import { validateTrack } from './validate.ts';

/** Themes a player track may use (each draws its own scenery and life). */
export const TRACK_THEMES = ['countryside', 'desert', 'winter', 'nuclear', 'brewery', 'tivoli', 'cigar', 'city'] as const;

/** Landmarks per theme (scenery at fixed spots). */
export const THEME_LANDMARKS: Readonly<Record<string, readonly string[]>> = {
  brewery: ['brewhouse', 'mug', 'tent'],
  tivoli: ['ferriswheel', 'carousel', 'bigtop'],
  cigar: ['factory', 'cigar', 'humidor'],
  city: ['tower', 'liberty', 'board', 'subway'],
};
const LANDMARKS = ['brewhouse', 'mug', 'tent', 'ferriswheel', 'carousel', 'bigtop', 'factory', 'cigar', 'humidor', 'tower', 'liberty', 'board', 'subway'];

/** Surfaces a patch may have. */
export const PATCH_SURFACES: readonly SurfaceId[] = [Surface.Gravel, Surface.Ice, Surface.Oil, Surface.Wet, Surface.Snow, Surface.ShallowWater, Surface.Grass];

export const LIMITS = {
  points: [3, 40],
  patches: 16,
  ramps: 4,
  landmarks: 6,
  /** How far from the origin anything may be, metres. */
  extent: 1500,
  width: [12, 24],
  cornerWiden: [0, 4],
  runoff: [2, 8],
  radius: [6, 400],
  name: 24,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const half = (v: number) => Math.round(v * 2) / 2;
const NAME_OK = /[^A-Z0-9 .'!&-]/g;

/** A track name as it may be shown: capitals, digits and a little punctuation. */
export function cleanTrackName(name: string): string {
  return (name ?? '').toUpperCase().replace(NAME_OK, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name) || 'MY TRACK';
}

/**
 * The canonical form of a player track: everything rounded to what the
 * share code stores, within the limits, no bridges, and an id made from a
 * hash of the content (the same track always gets the same id).
 */
export function canonicalDef(def: TrackDef): TrackDef {
  const ext = LIMITS.extent;
  const pos = (v: number) => half(clamp(v, -ext, ext));
  const path: PathPoint[] = def.path.slice(0, LIMITS.points[1]).map((p) => ({ x: pos(p.x), z: pos(p.z), r: Math.round(clamp(p.r, LIMITS.radius[0], LIMITS.radius[1])) }));
  const patches: SurfacePatch[] = (def.patches ?? []).slice(0, LIMITS.patches).map((p) => {
    const out: SurfacePatch = { surface: PATCH_SURFACES.includes(p.surface) ? p.surface : Surface.Gravel, x: pos(p.x), z: pos(p.z), r: half(clamp(p.r, 0, 60)) };
    if (p.runoff) out.runoff = true;
    if (p.hx !== undefined && p.hz !== undefined) {
      out.hx = half(clamp(p.hx, 1, 60));
      out.hz = half(clamp(p.hz, 1, 60));
      out.r = 0;
    }
    return out;
  });
  const ramps: RampDef[] = (def.ramps ?? []).slice(0, LIMITS.ramps).map((r) => ({ x: pos(r.x), z: pos(r.z), length: half(clamp(r.length, 6, 16)), height: Math.round(clamp(r.height, 0.5, 2.5) * 10) / 10 }));
  const theme = (TRACK_THEMES as readonly string[]).includes(def.theme) ? def.theme : 'countryside';
  const kinds = THEME_LANDMARKS[theme] ?? [];
  const landmarks = (def.landmarks ?? []).filter((l) => kinds.includes(l.kind)).slice(0, LIMITS.landmarks).map((l) => ({ kind: l.kind, x: pos(l.x), z: pos(l.z) }));
  const out: TrackDef = {
    id: '',
    name: cleanTrackName(def.name),
    theme,
    width: half(clamp(def.width, LIMITS.width[0], LIMITS.width[1])),
    runoff: half(clamp(def.runoff, LIMITS.runoff[0], LIMITS.runoff[1])),
    path,
    startAt: Math.round(clamp(def.startAt, 0.05, 0.95) * 1000) / 1000,
    laps: Math.round(clamp(def.laps ?? 3, 1, 9)),
    seed: Math.round(clamp(def.seed ?? 1, 0, 9999)),
  };
  const widen = half(clamp(def.cornerWiden ?? 0, LIMITS.cornerWiden[0], LIMITS.cornerWiden[1]));
  if (widen > 0) out.cornerWiden = widen;
  if (def.runoffSurface !== undefined && PATCH_SURFACES.includes(def.runoffSurface)) out.runoffSurface = def.runoffSurface;
  const scale = Math.round(clamp(def.lapScale ?? 1, 1, 5));
  if (scale > 1) out.lapScale = scale;
  if (patches.length) out.patches = patches;
  if (ramps.length) out.ramps = ramps;
  if (landmarks.length) out.landmarks = landmarks;
  out.id = `u-${hash(body(out))}`;
  return out;
}

/** The content as a compact array (everything but the id). */
function body(d: TrackDef): unknown[] {
  const h2 = (v: number) => Math.round(v * 2);
  return [
    1, d.name, d.theme, h2(d.width), h2(d.cornerWiden ?? 0), h2(d.runoff), d.runoffSurface ?? -1, Math.round(d.startAt * 1000), d.laps ?? 3, d.lapScale ?? 1, d.seed ?? 1,
    d.path.flatMap((p) => [h2(p.x), h2(p.z), p.r]),
    (d.patches ?? []).flatMap((p) => [p.surface, h2(p.x), h2(p.z), h2(p.r), (p.runoff ? 1 : 0) | (p.hx !== undefined ? 2 : 0), h2(p.hx ?? 0), h2(p.hz ?? 0)]),
    (d.ramps ?? []).flatMap((r) => [h2(r.x), h2(r.z), h2(r.length), Math.round(r.height * 10)]),
    (d.landmarks ?? []).flatMap((l) => [LANDMARKS.indexOf(l.kind), h2(l.x), h2(l.z)]),
  ];
}

/** FNV-1a over a string, as 8 base-36 digits. */
function hash(v: unknown): string {
  const s = JSON.stringify(v);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** ASCII text (the code's JSON is plain ASCII: names are cleaned) to base64url, and back. */
function toB64(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i) & 255;
    const b = i + 1 < text.length ? text.charCodeAt(i + 1) & 255 : -1;
    const c = i + 2 < text.length ? text.charCodeAt(i + 2) & 255 : -1;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b < 0 ? 0 : b >> 4)];
    if (b >= 0) out += B64[((b & 15) << 2) | (c < 0 ? 0 : c >> 6)];
    if (c >= 0) out += B64[c & 63];
  }
  return out;
}
function fromB64(code: string): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const ch of code) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad code');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((acc >> bits) & 255);
    }
  }
  return out;
}

/** A share code for a track (its canonical form). */
export function encodeTrack(def: TrackDef): string {
  return toB64(JSON.stringify(body(canonicalDef(def))));
}

/** The longest share code accepted. */
export const MAX_CODE = 2400;

/** A track from a share code, or null if it isn't one. */
export function decodeTrack(code: string): TrackDef | null {
  if (typeof code !== 'string' || code.length > MAX_CODE || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  let a: unknown;
  try {
    a = JSON.parse(fromB64(code));
  } catch {
    return null;
  }
  if (!Array.isArray(a) || a[0] !== 1 || a.length !== 15) return null;
  const [, name, theme, w2, cw2, ro2, ros, start, laps, scale, seed, pathA, patchA, rampA, lmA] = a as unknown[];
  const nums = (v: unknown, stride: number): number[] | null => {
    if (!Array.isArray(v) || v.length % stride !== 0 || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
    return v as number[];
  };
  const path = nums(pathA, 3);
  const patches = nums(patchA, 7);
  const ramps = nums(rampA, 4);
  const lms = nums(lmA, 3);
  if (!path || !patches || !ramps || !lms || typeof name !== 'string' || typeof theme !== 'string') return null;
  if ([w2, cw2, ro2, ros, start, laps, scale, seed].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const n = (v: unknown) => v as number;
  if (path.length / 3 < LIMITS.points[0] || path.length / 3 > LIMITS.points[1]) return null;
  const def: TrackDef = {
    id: '',
    name,
    theme,
    width: n(w2) / 2,
    cornerWiden: n(cw2) / 2,
    runoff: n(ro2) / 2,
    startAt: n(start) / 1000,
    laps: n(laps),
    lapScale: n(scale),
    seed: n(seed),
    path: [],
  };
  if (n(ros) >= 0) def.runoffSurface = n(ros) as SurfaceId;
  const pts: PathPoint[] = [];
  for (let i = 0; i < path.length; i += 3) pts.push({ x: path[i] / 2, z: path[i + 1] / 2, r: path[i + 2] });
  def.path = pts;
  const patchList: SurfacePatch[] = [];
  for (let i = 0; i < patches.length; i += 7) {
    const p: SurfacePatch = { surface: patches[i] as SurfaceId, x: patches[i + 1] / 2, z: patches[i + 2] / 2, r: patches[i + 3] / 2 };
    if (patches[i + 4] & 1) p.runoff = true;
    if (patches[i + 4] & 2) {
      p.hx = patches[i + 5] / 2;
      p.hz = patches[i + 6] / 2;
    }
    patchList.push(p);
  }
  def.patches = patchList;
  const rampList: RampDef[] = [];
  for (let i = 0; i < ramps.length; i += 4) rampList.push({ x: ramps[i] / 2, z: ramps[i + 1] / 2, length: ramps[i + 2] / 2, height: ramps[i + 3] / 10 });
  def.ramps = rampList;
  const lmList: { kind: string; x: number; z: number }[] = [];
  for (let i = 0; i < lms.length; i += 3) {
    const kind = LANDMARKS[lms[i]];
    if (kind) lmList.push({ kind, x: lms[i + 1] / 2, z: lms[i + 2] / 2 });
  }
  def.landmarks = lmList;
  return canonicalDef(def);
}

/** True for player tracks (as opposed to the ones that ship with the game). */
export function isCustomId(id: string): boolean {
  return id.startsWith('u-');
}

export interface TrackCheck {
  /** The track as built (lite: no surface grid or racing line). */
  track: Track;
  /** Problems that stop it being driven at all (corners don't fit, overlaps...). */
  errors: string[];
  /** What it also needs to be raced online or published (a pit lane, catch-up pads). */
  missing: string[];
}

/** Build a track (lite) and say what is wrong with it, if anything. */
export function checkTrackDef(def: TrackDef): TrackCheck {
  const track = buildTrack(def, { lite: true });
  const errors = validateTrack(track);
  const missing: string[] = [];
  if (!track.pit) missing.push('no pit lane: the start straight is too short or has no room beside it');
  else if (track.pit.box1 - track.pit.box0 <= 30) missing.push('pit box is 30 m or shorter: lengthen the start straight');
  if (track.boosts.length < 2) missing.push(`only ${track.boosts.length} catch-up pad(s), need 2: add straights of 24 m+ away from the start`);
  return { track, errors, missing };
}
