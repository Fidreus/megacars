import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8787);

/** public/<dir> files matching `re`, as site paths. */
function publicFiles(dir: string, re: RegExp): string[] {
  return readdirSync(new URL(`./public/${dir}/`, import.meta.url))
    .filter((f) => re.test(f))
    .map((f) => `/${dir}/${f}`);
}

/**
 * Writes precache.json: everything the game needs to run offline (the page,
 * the build, workers, the music player and the bundled songs). The service
 * worker downloads it all when it installs.
 */
function precacheList(): Plugin {
  return {
    name: 'megacars-precache',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = ['/', '/manifest.webmanifest'];
      for (const name of Object.keys(bundle)) if (!name.endsWith('.map') && name !== 'index.html') files.push(`/${name}`);
      files.push(
        ...publicFiles('icons', /\.png$/),
        ...publicFiles('audio', /\.js$/),
        ...publicFiles('vendor/libopenmpt', /\.(js|wasm)$/),
        ...publicFiles('music', /\.(mod|xm|s3m|it)$/i),
      );
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  plugins: [precacheList()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/healthz': { target: `http://localhost:${SERVER_PORT}` },
      '/dev': { target: `http://localhost:${SERVER_PORT}` },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
