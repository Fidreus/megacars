// Game version, from package.json (injected by Vite at build time).

declare const __APP_VERSION__: string;

export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
