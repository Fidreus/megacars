import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
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
