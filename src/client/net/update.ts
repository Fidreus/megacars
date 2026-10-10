// Is there a newer game on the server? An installed app (PWA) has no reload
// button, so the title screen offers the update. The main bundle's file name
// has a content hash: if the server's differs from ours, a new build is out.

/** Our own bundle file name (empty in development). */
const MINE = (() => {
  if (import.meta.env.DEV) return '';
  try {
    return new URL(import.meta.url).pathname.split('/').pop() ?? '';
  } catch {
    return '';
  }
})();

const EVERY_MS = 2 * 60 * 1000;

export class UpdateCheck {
  /** A newer build is on the server. */
  available = false;
  /** Its version number, when known. */
  version = '';

  start(): void {
    if (!MINE) return;
    void this.check();
    setInterval(() => void this.check(), EVERY_MS);
    // Phones pause apps in the background: look again when we come back.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.check();
    });
  }

  async check(): Promise<void> {
    if (this.available || !MINE) return;
    try {
      const res = await fetch('/api/version', { cache: 'no-store' });
      if (!res.ok) return;
      const v = (await res.json()) as { version: string; build: string };
      if (v.build && v.build !== MINE) {
        this.available = true;
        this.version = v.version;
      }
    } catch {
      // Offline: try again later.
    }
  }

  /** Load the new version (past the service worker's cached copy). */
  apply(): void {
    const reload = () => location.reload();
    const sw = navigator.serviceWorker;
    if (!sw) {
      reload();
      return;
    }
    void sw.getRegistration().then((r) => r?.update()).catch(() => {}).finally(reload);
  }
}
