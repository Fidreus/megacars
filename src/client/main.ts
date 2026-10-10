import { App } from './app.ts';
import { readParams } from './params.ts';

function fatal(err: unknown): void {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.style.display = 'block';
  document.getElementById('loading')?.remove();
  el.textContent = `Megacars crashed:\n\n${err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)}`;
}

window.addEventListener('error', (e) => fatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const app = new App(canvas, readParams());
  app.start();
  // The first frame is up: drop the loading screen.
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('loading')?.remove()));
} catch (err) {
  fatal(err);
}

// Installable app with offline single player (production builds only; a
// service worker would get in the way of the dev server's hot reload).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Plays fine without it.
    });
  });
}
