// URL parameters, e.g. ?ai=7&track=proving&debug=1&scale=4&mpp=0.2

export interface Params {
  debug: boolean;
  track: string;
  ai: number;
  seed: number;
  scale: number | null;
  mpp: number | null;
  scanlines: boolean;
  mute: boolean;
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
    debug: flag('debug'),
    track: q.get('track') ?? 'proving',
    ai: Math.max(0, Math.min(7, num('ai') ?? 3)),
    seed: num('seed') ?? 1,
    scale: num('scale'),
    mpp: num('mpp'),
    scanlines: flag('scanlines'),
    mute: flag('mute'),
  };
}
