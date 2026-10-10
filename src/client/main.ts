import { App } from './app.ts';
import { readParams } from './params.ts';

function fatal(err: unknown): void {
  const el = document.getElementById('fatal');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = `Megacars crashed:\n\n${err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)}`;
}

window.addEventListener('error', (e) => fatal(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => fatal(e.reason));

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const app = new App(canvas, readParams());
  app.start();
} catch (err) {
  fatal(err);
}
