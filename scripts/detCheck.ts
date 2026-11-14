// Cross-engine determinism check: runs scripts/detRace.ts (long races hashed
// every 5 s, recorded lap replays, track geometry, the maths table) in Node and
// in Playwright's browsers, loading the shared code through a private Vite
// server, and fails if any result differs by a single bit.
// `node scripts/detCheck.ts [--port 5199] [--browsers chromium,firefox,webkit] [--out file.json]`

import { createServer } from 'vite';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { measure, runAll } from './detRace.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const port = Number(arg('port', '5199'));
const wanted = arg('browsers', 'chromium,firefox,webkit').split(',');
const outFile = arg('out', '');

type Recorded = { spec: unknown; replay: string; laps: number[] };
type Result = { tracks: Record<string, string>; races: { name: string; hashes: string[]; end: string }[]; records: Recorded[]; table: string[] };

const require = createRequire(import.meta.url);
const pw = require('playwright') as Record<string, { launch(): Promise<any>; executablePath(): string }>;

let t0 = performance.now();
const node = runAll() as Result;
console.log(`node: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
const results: Record<string, Result> = { node };
const crossLaps: Record<string, { engine: string; recordedBy: string; recorded: string; measured: string }[]> = {};

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'error', server: { port, strictPort: true, hmr: false } });
await vite.listen();
let failed = false;
try {
  for (const name of wanted) {
    const b = pw[name];
    if (!b || !existsSync(b.executablePath())) {
      console.log(`${name}: not installed, skipped`);
      continue;
    }
    const browser = await b.launch();
    try {
      const page = await browser.newPage();
      page.on('pageerror', (e: Error) => console.log(`${name} page error: ${e.message}`));
      page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') console.log(`${name} console: ${m.text()}`); });
      page.on('response', (r: { status(): number; url(): string }) => { if (r.status() >= 400) console.log(`${name}: ${r.status()} ${r.url()}`); });
      // A blank page on the Vite origin (Vite's own 404 page forbids scripts).
      await page.route(`http://localhost:${port}/`, (r: any) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>det</title>' }));
      await page.goto(`http://localhost:${port}/`);
      t0 = performance.now();
      const r = (await page.evaluate(async () => {
        const m = await import('/scripts/detRace.ts' as string);
        return m.runAll();
      })) as Result;
      console.log(`${name}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
      results[name] = r;
      // The browser's recordings measured by Node (as the record server does), and Node's by the browser.
      const list = (crossLaps[name] = [] as { engine: string; recordedBy: string; recorded: string; measured: string }[]);
      for (const rec of r.records) list.push({ engine: 'node', recordedBy: name, recorded: JSON.stringify(rec.laps), measured: measure(rec.spec as never, rec.replay) });
      for (const rec of node.records) {
        const measured = (await page.evaluate(async ([spec, replay]: [unknown, string]) => {
          const m = await import('/scripts/detRace.ts' as string);
          return m.measure(spec, replay);
        }, [rec.spec, rec.replay])) as string;
        list.push({ engine: name, recordedBy: 'node', recorded: JSON.stringify(rec.laps), measured });
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  await vite.close();
}

// Compare every engine with Node.
for (const [name, r] of Object.entries(results)) {
  if (name === 'node') continue;
  let bad = 0;
  for (const id of Object.keys(node.tracks)) if (node.tracks[id] !== r.tracks[id]) { bad++; console.log(`  ${name}: track ${id} geometry differs`); }
  node.table.forEach((x, i) => { if (x !== r.table[i]) { bad++; if (bad < 20) console.log(`  ${name}: maths table row ${i}: node ${x} / ${name} ${r.table[i]}`); } });
  if (!bad) console.log(`  ${name}: ${Object.keys(node.tracks).length} track geometries and ${node.table.length} maths table rows identical`);
  node.races.forEach((race, i) => {
    const other = r.races[i];
    const k = race.hashes.findIndex((h, j) => h !== other.hashes[j]);
    if (k >= 0 || race.end !== other.end || race.hashes.length !== other.hashes.length) {
      bad++;
      console.log(`  ${name}: race "${race.name}" diverges at checkpoint ${k} (tick ${(k + 1) * 300})`);
      console.log(`    node: ${race.end}\n    ${name}: ${other.end}`);
    } else console.log(`  ${name}: race "${race.name}": ${race.hashes.length} checkpoints identical, ${race.end.slice(0, 40)}...`);
  });
  node.records.forEach((rec, i) => {
    if (rec.replay !== r.records[i].replay || JSON.stringify(rec.laps) !== JSON.stringify(r.records[i].laps)) {
      bad++;
      console.log(`  ${name}: record run ${i}: laps node ${JSON.stringify(rec.laps)} / ${name} ${JSON.stringify(r.records[i].laps)}`);
    }
  });
  for (const c of crossLaps[name]) {
    const ok = c.measured === JSON.stringify({ laps: JSON.parse(c.recorded) });
    if (!ok) bad++;
    console.log(`  recorded in ${c.recordedBy} ${c.recorded}, measured by ${c.engine} ${c.measured} ${ok ? 'OK' : 'MISMATCH'}`);
  }
  console.log(`${name} vs node: ${bad ? `${bad} DIFFERENCES` : 'bit-identical'}`);
  if (bad) failed = true;
}
if (outFile) writeFileSync(outFile, JSON.stringify({ results, crossLaps }, null, 1));
if (Object.keys(results).length < 2) {
  console.log('no browser ran: nothing was compared');
  failed = true;
}
process.exit(failed ? 1 : 0);
