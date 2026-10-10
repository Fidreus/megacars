import { defineConfig } from 'vitest/config';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8787);

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
      '/healthz': { target: `http://localhost:${SERVER_PORT}` },
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
