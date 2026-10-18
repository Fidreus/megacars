// Check a track while designing it: build and validate it, describe the
// layout (sections, start straight, pit, boost pads), race the AI round it
// and optionally draw it to an SVG.
//
//   npm run track -- tivoli                       a track in the game, by id
//   npm run track -- src/shared/track/defs/x.ts   a def file not yet in the game
//   npm run track -- draft.json                   a TrackDef as JSON
//   options: --seeds 3 --laps 3 --weapons --svg out.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { simulateRace } from '../src/shared/game/raceSim.ts';
import { buildTrack } from '../src/shared/track/builder.ts';
import { TRACKS } from '../src/shared/track/defs/index.ts';
import type { Track, TrackDef } from '../src/shared/track/types.ts';
import { validateTrack } from '../src/shared/track/validate.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const target = args[0];
if (!target || target.startsWith('--')) {
  console.log('usage: npm run track -- <track id | def.ts | def.json> [--seeds 3] [--laps 3] [--weapons] [--svg out.svg]');
  process.exit(1);
}

async function loadDef(what: string): Promise<TrackDef> {
  if (what.endsWith('.json')) return JSON.parse(readFileSync(what, 'utf8')) as TrackDef;
  if (what.endsWith('.ts')) {
    const mod = (await import(pathToFileURL(resolve(what)).href)) as Record<string, unknown>;
    const def = Object.values(mod).find((v): v is TrackDef => typeof v === 'object' && v !== null && 'path' in v);
    if (!def) throw new Error(`no TrackDef exported from ${what}`);
    return def;
  }
  const def = TRACKS[what];
  if (!def) throw new Error(`unknown track "${what}" (known: ${Object.keys(TRACKS).join(', ')})`);
  return def;
}

const def = await loadDef(target);
const track = buildTrack(def);
const errors = validateTrack(track);
// What the tests over every track in the game ask for (pit.test.ts, catchUp.test.ts).
if (!track.pit) errors.push('no pit lane: the start straight is too short or has no room beside it');
else if (track.pit.box1 - track.pit.box0 <= 30) errors.push('pit box is 30 m or shorter: lengthen the start straight');
if (track.boosts.length < 2) errors.push(`only ${track.boosts.length} catch-up pad(s), need 2: add straights of 24 m+ away from the start`);

// Straight samples before and after the start line.
const straight = (i: number) => Math.abs(track.curv[i]) < 1e-6;
let before = 0;
while (before < track.n && straight((track.n - 1 - before + track.n) % track.n)) before++;
let after = 0;
while (after < track.n && straight(after)) after++;

// Sections in driving order: S = straight, L/R = left/right bend, with length in metres.
const sections: string[] = [];
let cur = 0;
let len = 0;
for (let i = 0; i < track.n; i++) {
  const k = Math.sign(Math.round(track.curv[i] * 1e6));
  if (k !== cur && len) {
    sections.push(`${cur > 0 ? 'R' : cur < 0 ? 'L' : 'S'}${len}`);
    len = 0;
  }
  cur = k;
  len++;
}
sections.push(`${cur > 0 ? 'R' : cur < 0 ? 'L' : 'S'}${len}`);

const hwMin = Math.min(...track.hw);
const hwMax = Math.max(...track.hw);
console.log(`${def.name} (${def.id}), theme ${def.theme}`);
console.log(`  length ${track.length.toFixed(0)} m, road ${(2 * hwMin).toFixed(1)}${hwMax > hwMin + 0.01 ? `-${(2 * hwMax).toFixed(1)}` : ''} m wide, laps ${def.laps ?? 3}${def.lapScale ? ` x${def.lapScale}` : ''}`);
console.log(`  errors: ${errors.length ? `\n    - ${errors.join('\n    - ')}` : 'none'}`);
console.log(`  start straight: ${before} m before the line, ${after} m after`);
console.log(`  pit: ${track.pit ? `${track.pit.side > 0 ? 'right' : 'left'} side, repair zone ${(track.pit.zone1 - track.pit.zone0).toFixed(0)} m` : 'none'}`);
console.log(`  boost pads: ${track.boosts.length ? track.boosts.map((s) => s.toFixed(0)).join(', ') + ' (s, m)' : 'none'}`);
console.log(`  sections: ${sections.join(' ')}`);
console.log(`  bounds: x ${track.bounds.minX.toFixed(0)}..${track.bounds.maxX.toFixed(0)}, z ${track.bounds.minZ.toFixed(0)}..${track.bounds.maxZ.toFixed(0)}`);

if (args.includes('--svg')) {
  const out = arg('svg', `${def.id}.svg`);
  writeFileSync(out, svg(track));
  console.log(`  drawing: ${out}`);
}

if (errors.length) process.exit(1);

const seeds = Number(arg('seeds', '3'));
const laps = Number(arg('laps', String(def.laps ?? 3)));
const weapons = args.includes('--weapons');
console.log(`\nAI races (8 cars, ${laps} laps${weapons ? ', weapons' : ''}):`);
let bad = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const r = simulateRace(def, seed, { laps, weapons });
  const ok = r.finished === r.cars;
  if (!ok) bad++;
  console.log(`  seed ${seed}  ${ok ? 'OK ' : 'BAD'}  finished ${r.finished}/${r.cars}  winner ${r.winnerSeconds.toFixed(1)} s  best lap ${r.bestLapSeconds.toFixed(2)} s  respawns ${r.respawns}  wall hits ${r.wallHits}`);
}
process.exit(bad ? 1 : 0);

/** Top-down drawing in world coordinates (x right, z down: as the game camera sees it). */
function svg(t: Track): string {
  const pad = 20;
  const { minX, minZ, maxX, maxZ } = t.bounds;
  const w = maxX - minX + 2 * pad;
  const h = maxZ - minZ + 2 * pad;
  const parts: string[] = [];
  const poly = (xs: ArrayLike<number>, zs: ArrayLike<number>, n: number, step: number, style: string) => {
    const p: string[] = [];
    for (let i = 0; i < n; i += step) p.push(`${xs[i].toFixed(1)},${zs[i].toFixed(1)}`);
    parts.push(`<polygon points="${p.join(' ')}" ${style}/>`);
  };
  // Road edges as one thick stroke along the centreline would hide width changes, so draw both edges.
  const ex = (side: number) => Array.from({ length: t.n }, (_, i) => t.px[i] + t.nx[i] * t.hw[i] * side);
  const ez = (side: number) => Array.from({ length: t.n }, (_, i) => t.pz[i] + t.nz[i] * t.hw[i] * side);
  for (const o of t.walls.outlines) {
    const xs = o.filter((_, k) => k % 2 === 0);
    const zs = o.filter((_, k) => k % 2 === 1);
    poly(xs, zs, xs.length, 1, 'fill="none" stroke="#c8261f" stroke-width="0.8"');
  }
  poly(ex(1), ez(1), t.n, 2, 'fill="none" stroke="#333" stroke-width="0.6"');
  poly(ex(-1), ez(-1), t.n, 2, 'fill="none" stroke="#333" stroke-width="0.6"');
  poly(t.px, t.pz, t.n, 2, 'fill="none" stroke="#999" stroke-width="0.4" stroke-dasharray="3 3"');
  poly(t.line.x, t.line.z, t.n, 2, 'fill="none" stroke="#2f6fe0" stroke-width="0.5"');
  for (const p of t.def.patches ?? []) {
    const shape = p.hx !== undefined ? `<rect x="${p.x - p.hx}" y="${p.z - (p.hz ?? p.hx)}" width="${2 * p.hx}" height="${2 * (p.hz ?? p.hx)}"` : `<circle cx="${p.x}" cy="${p.z}" r="${p.r}"`;
    parts.push(`${shape} fill="#f2c230" fill-opacity="0.35"/>`);
  }
  for (const s of t.boosts) {
    const i = Math.round((s / t.length) * t.n) % t.n;
    parts.push(`<circle cx="${t.px[i].toFixed(1)}" cy="${t.pz[i].toFixed(1)}" r="3" fill="#33d6ff"/>`);
  }
  for (const g of t.grid) parts.push(`<circle cx="${g.x.toFixed(1)}" cy="${g.z.toFixed(1)}" r="1.2" fill="#222"/>`);
  const a = (side: number) => [t.px[0] + t.nx[0] * t.hw[0] * side, t.pz[0] + t.nz[0] * t.hw[0] * side].map((v) => v.toFixed(1));
  parts.push(`<line x1="${a(-1)[0]}" y1="${a(-1)[1]}" x2="${a(1)[0]}" y2="${a(1)[1]}" stroke="#000" stroke-width="1.5"/>`);
  for (const lm of t.def.landmarks ?? []) {
    parts.push(`<rect x="${lm.x - 4}" y="${lm.z - 4}" width="8" height="8" fill="#8a4ad8"/><text x="${lm.x + 6}" y="${lm.z + 3}" font-size="8">${lm.kind}</text>`);
  }
  t.def.path.forEach((p, k) => parts.push(`<text x="${p.x + 3}" y="${p.z - 3}" font-size="9" fill="#a00">${k}</text>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minZ - pad} ${w} ${h}" width="${Math.round(w * 2)}" height="${Math.round(h * 2)}" style="background:#4c8a3a">\n${parts.join('\n')}\n</svg>\n`;
}
