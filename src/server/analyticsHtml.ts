// The usage summary as a page to read in a browser (GET /api/stats?format=html).
// One self-contained document: no scripts, no external files.

import { mmss, type Count, type Summary } from './analyticsStats.ts';

const esc = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

let regions: Intl.DisplayNames | null | undefined;
function country(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🌐 Unknown';
  regions ??= (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' });
    } catch {
      return null;
    }
  })();
  const flag = String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
  let name = code;
  try {
    name = regions?.of(code) ?? code;
  } catch {
    // Keep the code.
  }
  return `${flag} ${name}`;
}

function card(label: string, value: string | number, note = ''): string {
  return `<div class="card"><div class="v">${esc(value)}</div><div class="l">${esc(label)}</div>${note ? `<div class="n">${esc(note)}</div>` : ''}</div>`;
}

/** Horizontal bars, widest first, each with its share. */
function bars(items: Count[], opts: { max?: number; label?: (k: string) => string; total?: number } = {}): string {
  const shown = items.slice(0, opts.max ?? 10);
  if (!shown.length) return '<p class="none">No data yet.</p>';
  const top = Math.max(...shown.map((i) => i.n));
  const total = opts.total ?? items.reduce((a, i) => a + i.n, 0);
  return `<div class="bars">${shown
    .map((i) => {
      const pct = total ? Math.round((100 * i.n) / total) : 0;
      return `<div class="row"><span class="k">${esc(opts.label ? opts.label(i.key) : i.key)}</span><span class="bar"><i style="width:${(100 * i.n) / top}%"></i></span><span class="n">${i.n} <small>${pct}%</small></span></div>`;
    })
    .join('')}</div>`;
}

/** Vertical columns with a label under each (every `every`th). */
function columns(values: number[], labels: string[], opts: { every?: number; titles?: string[]; color?: string } = {}): string {
  const top = Math.max(1, ...values);
  const every = opts.every ?? 1;
  return `<div class="cols">${values
    .map((v, i) => {
      const title = opts.titles?.[i] ?? `${labels[i]}: ${v}`;
      return `<div class="col" title="${esc(title)}"><span class="num">${v || ''}</span><span class="b"><i style="height:${(100 * v) / top}%;${opts.color ? `background:${opts.color}` : ''}"></i></span><span class="lab">${i % every === 0 ? esc(labels[i]) : ''}</span></div>`;
    })
    .join('')}</div>`;
}

const panel = (title: string, body: string, wide = false) => `<section class="panel${wide ? ' wide' : ''}"><h2>${esc(title)}</h2>${body}</section>`;

export interface PageOptions {
  /** Query string to keep on the links (the token), without the leading ?. */
  keep: string;
  generated?: Date;
}

export function renderHtml(s: Summary, opts: PageOptions): string {
  const t = s.totals;
  const link = (days: number) => {
    const q = new URLSearchParams(opts.keep);
    q.set('format', 'html');
    q.set('days', String(days));
    q.set('tz', s.tz);
    return `?${q.toString()}`;
  };
  const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
  const lengthStats = `Median ${mmss(s.sessions.medianSec)}, average ${mmss(s.sessions.avgSec)}, 90% stay less than ${mmss(s.sessions.p90Sec)}.`;
  const dayLabels = s.perDay.map((d) => d.day.slice(5));
  const manyDays = s.days > 60 ? 14 : s.days > 30 ? 7 : s.days > 14 ? 3 : s.days > 7 ? 2 : 1;
  const body = !t.visitors && !t.races
    ? '<p class="none big">No usage logged in this period.</p>'
    : `
    <div class="cards">
      ${card('Visitors', t.visitors, 'counted once per day')}
      ${card('Page loads', t.opens)}
      ${card('Races started', t.races, `${t.onlineRaces} online`)}
      ${card('Time on page', mmss(s.sessions.medianSec), 'median')}
      ${card('Started a race', `${pct(s.funnel.raced, s.funnel.opened)}%`, `${s.funnel.raced} of ${s.funnel.opened} page loads`)}
      ${card('Races per visitor', t.visitors ? (t.races / t.visitors).toFixed(1) : '0')}
    </div>
    <div class="grid">
      ${panel('Visitors per day', columns(s.perDay.map((d) => d.visitors), dayLabels, { every: manyDays, titles: s.perDay.map((d) => `${d.day}: ${d.visitors} visitors, ${d.opens} page loads, ${d.races} races`) }), true)}
      ${panel('Races per day', columns(s.perDay.map((d) => d.races), dayLabels, { every: manyDays, color: 'var(--accent2)' }), true)}
      ${panel(`Time of day (${s.tz})`, `${columns(s.hours.opens, s.hours.opens.map((_, h) => String(h)), { every: 3, titles: s.hours.opens.map((n, h) => `${h}:00: ${n} page loads, ${s.hours.races[h]} races`) })}<p class="sub">Page loads per hour. Races per hour:</p>${columns(s.hours.races, s.hours.races.map((_, h) => String(h)), { every: 3, color: 'var(--accent2)' })}`, true)}
      ${panel('Weekday', columns(s.weekdays.opens, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], { titles: s.weekdays.opens.map((n, i) => `${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}: ${n} page loads, ${s.weekdays.races[i]} races`) }))}
      ${panel('Countries', bars(s.countries, { max: 12, label: country }))}
      ${panel('Device', bars(s.devices))}
      ${panel('Browser', bars(s.browsers))}
      ${panel('Operating system', bars(s.systems))}
      ${panel('Screen width', bars(s.screens))}
      ${panel('Language', bars(s.languages, { label: (k) => k.toUpperCase() }))}
      ${panel('Came from', s.referrers.length ? bars(s.referrers) : '<p class="none">Everyone came directly (or without a referrer).</p>')}
      ${panel('How long they stay', `<p class="sub">${esc(lengthStats)} ${s.sessions.withRace}% started a race.</p>${bars(s.sessions.lengths, { max: 7, total: s.sessions.count })}`)}
      ${panel('Tracks', bars(s.tracks.map((r) => ({ key: r.name, n: r.starts })), { max: 15 }), true)}
      ${panel('Game mode', `${bars(s.modes)}<p class="sub">On average ${s.racesDetail.avgLaps} laps and ${s.racesDetail.avgOpponents} opponents. ${s.racesDetail.splitScreen}% in split screen.</p>`)}
      ${panel('Online', s.online.connections || s.online.races.length
        ? `<p class="sub">${s.online.connections} connections. Median ${mmss(s.online.medianSec)}, average ${mmss(s.online.avgSec)}. ${s.online.publicShare}% of races in public rooms.</p>${bars(s.online.races.map((r) => ({ key: `${r.name} · ${r.humans} ${r.humans === 1 ? 'player' : 'players'}`, n: r.races })))}`
        : '<p class="none">No online races yet.</p>')}
    </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Megacars – statistics</title>
<style>
  :root { color-scheme: dark; --bg:#0a0c1a; --panel:#141830; --line:#262c50; --text:#e8ecf8; --dim:#8090a8; --accent:#ffd84a; --accent2:#ff6b5e; --bar:#3f6fe0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 ui-monospace, Menlo, Consolas, monospace; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; justify-content: space-between; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: 3px; color: var(--accent); }
  nav a { color: var(--dim); text-decoration: none; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; margin-left: 4px; }
  nav a.on, nav a:hover { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .meta { color: var(--dim); font-size: 12px; margin: 0 0 16px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
  .card .v { font-size: 28px; color: var(--accent); line-height: 1.1; }
  .card .l { color: var(--text); margin-top: 4px; }
  .card .n { color: var(--dim); font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; min-width: 0; }
  .panel.wide { grid-column: 1 / -1; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: 2px; text-transform: uppercase; color: var(--dim); font-weight: 600; }
  .sub { color: var(--dim); font-size: 12px; margin: 8px 0; }
  .none { color: var(--dim); margin: 4px 0; } .none.big { text-align: center; padding: 48px 0; font-size: 18px; }
  .row { display: grid; grid-template-columns: minmax(90px, 42%) 1fr auto; gap: 8px; align-items: center; padding: 3px 0; }
  .row .k { overflow-wrap: anywhere; line-height: 1.2; }
  .row .bar { background: #0e1228; border-radius: 3px; height: 12px; overflow: hidden; }
  .row .bar i { display: block; height: 100%; background: var(--bar); border-radius: 3px; }
  .row .n { text-align: right; white-space: nowrap; } .row small { color: var(--dim); }
  .cols { display: flex; align-items: stretch; gap: 2px; height: 130px; }
  .col { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; position: relative; }
  .col .b { flex: 1 1 0; width: 100%; display: flex; align-items: flex-end; min-height: 0; }
  .col i { display: block; width: 100%; min-height: 1px; background: var(--bar); border-radius: 2px 2px 0 0; }
  .col .num { font-size: 10px; color: var(--dim); height: 14px; line-height: 14px; }
  .col .lab { font-size: 10px; color: var(--dim); height: 14px; line-height: 14px; white-space: nowrap; overflow: visible; }
  @media (max-width: 520px) { .col .num { display: none; } }
</style>
</head>
<body>
<main>
<header>
  <h1>MEGACARS · STATISTICS</h1>
  <nav>${[1, 7, 30, 90].map((d) => `<a href="${esc(link(d))}"${d === s.days ? ' class="on"' : ''}>${d === 1 ? 'Today' : `${d} days`}</a>`).join('')}</nav>
</header>
<p class="meta">${esc(s.from)} – ${esc(s.to)}. Days are counted in UTC, times of day in ${esc(s.tz)} (add <code>&amp;tz=Europe/London</code> for another time zone). No IP addresses are stored; visitors are hashes that change every day, so the same person is counted again the next day. Updated ${esc((opts.generated ?? new Date()).toISOString().replace('T', ' ').slice(0, 16))} UTC.</p>
${body}
</main>
</body>
</html>
`;
}
