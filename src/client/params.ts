// URL parameters, e.g. ?mode=quick&p2=1&laps=2&ai=5&difficulty=2&mood=night&debug=1

export interface Params {
  /** 'title' (default), 'quick' (straight into a race) or 'practice'. */
  mode: string;
  debug: boolean;
  /** Track id from ?track= (empty = keep the saved choice). */
  track: string;
  /** Number of computer opponents (only applied when `aiSet`). */
  ai: number;
  aiSet: boolean;
  p2: boolean;
  laps: number | null;
  difficulty: number | null;
  seed: number;
  scale: number | null;
  mpp: number | null;
  scanlines: boolean;
  mute: boolean;
  mood: string | null;
  /** Online room code to join straight away (invite links). */
  room: string | null;
  /** A shared player track (?t=, the track editor's share link). */
  trackCode: string | null;
}

export function readParams(search: string = location.search): Params {
  const q = new URLSearchParams(search);
  const num = (k: string): number | null => {
    const v = q.get(k);
    if (v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const flag = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  return {
    mode: q.get('mode') ?? 'title',
    debug: flag('debug'),
    track: q.get('track') ?? '',
    ai: Math.max(0, Math.min(7, num('ai') ?? 7)),
    aiSet: q.has('ai'),
    p2: flag('p2'),
    laps: num('laps'),
    difficulty: num('difficulty'),
    seed: num('seed') ?? 1,
    scale: num('scale'),
    mpp: num('mpp'),
    scanlines: flag('scanlines'),
    mute: flag('mute'),
    mood: q.get('mood'),
    trackCode: q.get('t') || null,
    room: q.get('room') ? q.get('room')!.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) || null : null,
  };
}
