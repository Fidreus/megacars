// Tells the server which tracks get raced and how long the page stays open,
// so the usage log (src/server/analytics.ts) covers single player too. No
// cookies, no storage, nothing that follows a person: a random id for this
// page load groups the reports. Nothing is sent with Do Not Track or Global
// Privacy Control on. (Umami's own script is in index.html.)

const enabled =
  typeof document !== 'undefined' &&
  navigator.doNotTrack !== '1' &&
  !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;

const sid = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
let visibleMs = 0;
let shownAt = enabled && document.visibilityState === 'visible' ? performance.now() : -1;
let races = 0;

function send(body: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    navigator.sendBeacon('/api/event', JSON.stringify({ sid, ...body }));
  } catch {
    // Offline or blocked: the game doesn't care.
  }
}

export interface RaceInfo {
  track: string;
  mode: 'quick' | 'practice' | 'cup' | 'career';
  laps: number;
  opponents: number;
  players: number;
}

/** A race was started on this device. */
export function trackRace(info: RaceInfo): void {
  races++;
  send({ t: 'race', ...info });
}

/** How long the page has been in front, in seconds. */
function visibleSeconds(): number {
  return Math.round((visibleMs + (shownAt >= 0 ? performance.now() - shownAt : 0)) / 1000);
}

if (enabled) {
  // Hiding is the last moment a phone gives us; each report replaces the one before it.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (shownAt >= 0) visibleMs += performance.now() - shownAt;
      shownAt = -1;
      send({ t: 'session', dur: Math.min(86_400, visibleSeconds()), races });
    } else shownAt = performance.now();
  });
}
