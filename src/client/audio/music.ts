// Tracker music (MOD/XM/S3M/IT) through libopenmpt in a Web Worker (see
// modPlayer.ts; loaded only when music first plays). Each screen
// and track has its song; songs fade out and in when the scene changes.
// People can drop their own module files on the window to add them to the
// shuffle list; those stay in their browser (IndexedDB) and are never uploaded.

import type { AudioSystem } from './audio.ts';
import { ModPlayer } from './modPlayer.ts';

export interface Song {
  file: string;
  title: string;
  artist: string;
  licence: string;
  /** A recording (.ogg, with an .mp3 next to it) instead of a tracker module. */
  audio?: boolean;
  /** Where it comes from (credits). */
  source?: string;
  /** Loudness correction for quiet songs. */
  gain?: number;
}

/**
 * Bundled songs (public/music), all checked on The Mod Archive. The CC BY-NC-SA
 * ones may only stay while the game is free (no ads, no paid extras).
 */
export const SONGS: Record<string, Song> = {
  title: { file: 'digital_rendezvous.xm', title: 'DIGITAL RENDEZVOUS', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  menu: { file: 'ambient_starfield.xm', title: 'AMBIENT STARFIELD', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  results: { file: 'the_digital_dragon.xm', title: 'THE DIGITAL DRAGON', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  greenvalley: { file: 'neon_techno.mod', title: 'NEON TECHNO', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  dustbowl: { file: 'bassline_techno.xm', title: 'BASSLINE TECHNO', artist: 'KATIE CADET', licence: 'PUBLIC DOMAIN' },
  frostring: { file: 'crush.xm', title: 'CRUSH', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  meltdown: { file: 'keygen_9000.xm', title: 'KEYGEN 9000', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  bitloader: { file: 'bit_loader.xm', title: 'BIT LOADER', artist: 'DROZERIX', licence: 'PUBLIC DOMAIN' },
  simplechip: { file: 'simple_chip_tune.xm', title: 'SIMPLE CHIP TUNE', artist: 'JAM', licence: 'PUBLIC DOMAIN' },
  numen: { file: 'numen_in_da_chip.xm', title: 'NUMEN IN DA CHIP', artist: 'JAM', licence: 'PUBLIC DOMAIN' },
  imagine: { file: 'imagine.xm', title: 'IMAGINE', artist: 'ANDREAS VIKLUND (TSEC)', licence: 'CC BY 4.0', gain: 2.5 },
  dreams: { file: 'dreams.xm', title: 'DREAMS', artist: 'ANDREAS VIKLUND (TSEC)', licence: 'CC BY 4.0', gain: 2.5 },
  dreams2: { file: 'dreams_2.xm', title: 'DREAMS 2', artist: 'ANDREAS VIKLUND (TSEC)', licence: 'CC BY 4.0', gain: 1.7 },
  elysium: { file: 'elysium.mod', title: 'ELYSIUM', artist: 'JESTER', licence: 'CC BY-NC-SA 4.0', gain: 1.8 },
  stardust: { file: 'stardust_memories.mod', title: 'STARDUST MEMORIES', artist: 'JESTER', licence: 'CC BY-NC-SA 4.0', gain: 1.3 },
  instinct: { file: 'basic_instinct.mod', title: 'BASIC INSTINCT', artist: 'JESTER', licence: 'CC BY-NC-SA 4.0', gain: 1.5 },
  unreal: { file: 'unreal_scene.it', title: 'UNREAL SCENE', artist: 'SAGA MUSIX', licence: 'CC BY-NC-SA 4.0', gain: 3 },
  snowflakes: { file: 'snowflakes.it', title: 'SNOWFLAKES', artist: 'SAGA MUSIX', licence: 'CC BY-NC-SA 4.0', gain: 3 },
  hawking: { file: 'hawkings_dream.xm', title: "HAWKING'S DREAM", artist: 'PSIRIUS', licence: 'CC BY-NC-SA 4.0', gain: 2.2 },
  dreams3: { file: 'dreams_3.xm', title: 'DREAMS 3', artist: 'ANDREAS VIKLUND (TSEC)', licence: 'CC BY 4.0', gain: 2.5 },
};

/** Tracks without a song of their own borrow one. */
const TRACK_SONG: Record<string, string> = { twinbridges: 'bitloader', brewerybash: 'numen', tivoli: 'simplechip', cigars: 'imagine', manhattan: 'dreams' };

/** Songs used for races in shuffle mode. */
const RACE_POOL = ['greenvalley', 'dustbowl', 'frostring', 'meltdown', 'bitloader', 'simplechip', 'numen', 'imagine', 'dreams', 'dreams2', 'dreams3',
  'elysium', 'stardust', 'instinct', 'unreal', 'snowflakes', 'hawking',
];

export const MUSIC_MODES = ['TRACKS', 'SHUFFLE', 'OFF'] as const;
export type MusicMode = 0 | 1 | 2;

/** What is on screen, which decides the song. */
export type MusicScene = { kind: 'title' } | { kind: 'menu' } | { kind: 'results' } | { kind: 'race'; track: string };

/**
 * Glide a gain to `to` over `secs` along a straight line from wherever it is
 * now. Linear ramps reach exactly zero (setTargetAtTime never does, so a song
 * stopped under it still clicks), and holding the current value first avoids
 * the jump back to the last set value that cancelScheduledValues causes.
 */
function fade(param: AudioParam, ctx: AudioContext, to: number, secs: number): void {
  const t = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
  param.linearRampToValueAtTime(to, t + secs);
}

const DB = 'megacars-music';
const SUPPORTED = /\.(mod|xm|s3m|it|mptm|669|mtm|med|okt|stm|ult|far)$/i;

export class Music {
  mode: MusicMode = 0;
  volume = 0.6;
  /** Title of what is playing (for the "now playing" toast). */
  nowPlaying = '';
  /** Own files dropped on the window: name -> bytes. */
  readonly own = new Map<string, ArrayBuffer>();
  private readonly audio: AudioSystem;
  private player: ModPlayer | null = null;
  private loading: Promise<ModPlayer | null> | null = null;
  private out: GainNode | null = null;
  private current = '';
  private scene: MusicScene = { kind: 'title' };
  private sceneKey = '';
  private readonly cache = new Map<string, ArrayBuffer>();
  private switchToken = 0;
  onSong: (title: string) => void = () => {};

  constructor(audio: AudioSystem) {
    this.audio = audio;
    void this.loadOwn();
  }

  setVolume(v: number): void {
    this.volume = v;
    // Not while a song is fading in or out: that fade decides the level.
    if (this.out && this.audio.ctx && !this.fading) fade(this.out.gain, this.audio.ctx, this.mode === 2 ? 0 : v * 0.55 * this.songGain, 0.15);
  }

  setMode(m: MusicMode): void {
    this.mode = m;
    this.current = '';
    if (m === 2) this.stop();
    else this.play(this.scene, true);
    this.setVolume(this.volume);
  }

  /** The scene changed (or the audio just unlocked): play its song. Cheap to call every frame. */
  play(scene: MusicScene, force = false): void {
    const sk = scene.kind === 'race' ? `race:${scene.track}` : scene.kind;
    if (!force && sk === this.sceneKey) return;
    this.sceneKey = sk;
    this.scene = scene;
    if (this.mode === 2 || !this.audio.ctx) return;
    const key = this.songFor(scene);
    if (!force && key === this.current) return;
    this.current = key;
    void this.switchTo(key);
  }

  /** Play a particular bundled song now (key of SONGS). */
  playSong(key: string): void {
    if (this.mode === 2 || !this.audio.ctx || !SONGS[key]) return;
    this.current = key;
    void this.switchTo(key);
  }

  /** Skip to another song (shuffle pool). */
  next(): void {
    if (this.mode === 2 || !this.audio.ctx) return;
    const pool = this.pool().filter((k) => k !== this.current);
    this.current = pool[Math.floor(Math.random() * pool.length)] ?? this.current;
    void this.switchTo(this.current);
  }

  private analyser: AnalyserNode | null = null;

  /** RMS level of the music output right now (debugging/tests). */
  level(): number {
    if (!this.out || !this.audio.ctx) return 0;
    if (!this.analyser) {
      this.analyser = this.audio.ctx.createAnalyser();
      this.out.connect(this.analyser);
    }
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  }

  stop(): void {
    // Cancel a song that is still loading.
    this.switchToken++;
    if (!this.out || !this.audio.ctx) return;
    fade(this.out.gain, this.audio.ctx, 0, 0.4);
    const p = this.player;
    const src = this.source;
    this.source = null;
    setTimeout(() => {
      p?.stop();
      src?.stop();
    }, 550);
    this.nowPlaying = '';
  }

  private pool(): string[] {
    return [...RACE_POOL, ...[...this.own.keys()].map((k) => `own:${k}`)];
  }

  private songFor(scene: MusicScene): string {
    if (scene.kind === 'race') {
      if (this.mode === 1) {
        const pool = this.pool();
        return pool[Math.floor(Math.random() * pool.length)];
      }
      const song = TRACK_SONG[scene.track] ?? scene.track;
      return SONGS[song] ? song : 'greenvalley';
    }
    return scene.kind;
  }

  private async switchTo(key: string): Promise<void> {
    const token = ++this.switchToken;
    const recording = !!SONGS[key]?.audio;
    // Recordings need only the output node; modules need the worklet player.
    const player = recording ? null : await this.ensurePlayer();
    const ctx = this.audio.ctx;
    if ((!recording && !player) || token !== this.switchToken || !ctx) return;
    const out = this.ensureOut(ctx);
    // Fade out what is playing (to exactly zero), then start the new song
    // silent and fade it in once it is really producing sound.
    this.fading = true;
    fade(out.gain, ctx, 0, 0.35);
    const data = recording ? await this.fetchRecording(key, ctx) : await this.fetchSong(key);
    await new Promise((r) => setTimeout(r, 450));
    if (!data || token !== this.switchToken || this.mode === 2) {
      if (token === this.switchToken) this.fading = false;
      return;
    }
    this.player?.stop();
    this.source?.stop();
    this.source = null;
    fade(out.gain, ctx, 0, 0.01);
    if (data instanceof AudioBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = data;
      src.loop = true;
      src.connect(out);
      // Start a moment ahead so the gain is surely at zero by then.
      src.start(ctx.currentTime + 0.05);
      this.source = src;
    } else {
      // The worker parses the module before the first note: wait for the
      // first samples so the fade-in doesn't start ahead of the music.
      const started = new Promise<void>((ok) => {
        this.onStarted = ok;
        setTimeout(ok, 1500);
      });
      player!.play(data);
      await started;
      this.onStarted = null;
      if (token !== this.switchToken || (this.mode as MusicMode) === 2) return;
    }
    this.songGain = SONGS[key]?.gain ?? 1;
    const t = ctx.currentTime + 0.06;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(this.volume * 0.55 * this.songGain, t + 1.2);
    setTimeout(() => {
      if (token === this.switchToken) this.fading = false;
    }, 1300);
    const song = SONGS[key];
    this.nowPlaying = song ? `${song.title} - ${song.artist}` : key.replace(/^own:/, '').toUpperCase();
    this.onSong(this.nowPlaying);
  }

  private source: AudioBufferSourceNode | null = null;
  private songGain = 1;
  /** A song switch owns the output gain until its fade-in is done. */
  private fading = false;
  private onStarted: (() => void) | null = null;
  private readonly decoded = new Map<string, AudioBuffer>();

  /** The music output (created once; module player and recordings both feed it). */
  private ensureOut(ctx: AudioContext): GainNode {
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = 0;
      this.out.connect(this.audio.bus ?? ctx.destination);
    }
    return this.out;
  }

  /** Decode a recording: Ogg Vorbis first, MP3 where the browser can't. */
  private async fetchRecording(key: string, ctx: AudioContext): Promise<AudioBuffer | null> {
    const song = SONGS[key];
    const hit = this.decoded.get(song.file);
    if (hit) return hit;
    for (const ext of ['ogg', 'mp3']) {
      try {
        const res = await fetch(`/music/${song.file}.${ext}`);
        if (!res.ok) continue;
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.decoded.set(song.file, buf);
        return buf;
      } catch {
        // Try the next format.
      }
    }
    return null;
  }

  private async fetchSong(key: string): Promise<ArrayBuffer | null> {
    if (key.startsWith('own:')) return this.own.get(key.slice(4)) ?? null;
    const song = SONGS[key];
    if (!song) return null;
    let bytes = this.cache.get(song.file);
    if (!bytes) {
      try {
        const res = await fetch(`/music/${song.file}`);
        if (!res.ok) return null;
        bytes = await res.arrayBuffer();
        this.cache.set(song.file, bytes);
      } catch {
        return null;
      }
    }
    return bytes;
  }

  private ensurePlayer(): Promise<ModPlayer | null> {
    if (this.player) return Promise.resolve(this.player);
    if (this.loading) return this.loading;
    const ctx = this.audio.ctx;
    if (!ctx) return Promise.resolve(null);
    this.loading = (async () => {
      try {
        const player = await ModPlayer.create(ctx);
        player.onStarted = () => this.onStarted?.();
        player.output.connect(this.ensureOut(ctx));
        this.player = player;
        return player;
      } catch (e) {
        console.warn('Music unavailable:', e);
        return null;
      }
    })();
    return this.loading;
  }

  // ------------------------------------------------------- own music files

  /** Add module files (from drag and drop). Returns how many were added. */
  async addFiles(files: Iterable<File>): Promise<number> {
    let n = 0;
    for (const f of files) {
      if (!SUPPORTED.test(f.name) || f.size > 8_000_000) continue;
      const bytes = await f.arrayBuffer();
      this.own.set(f.name, bytes);
      await this.store(f.name, bytes);
      n++;
    }
    return n;
  }

  async clearOwn(): Promise<void> {
    this.own.clear();
    const db = await openDb();
    if (!db) return;
    db.transaction('songs', 'readwrite').objectStore('songs').clear();
  }

  private async store(name: string, bytes: ArrayBuffer): Promise<void> {
    const db = await openDb();
    if (!db) return;
    db.transaction('songs', 'readwrite').objectStore('songs').put(bytes, name);
  }

  private async loadOwn(): Promise<void> {
    const db = await openDb();
    if (!db) return;
    const store = db.transaction('songs', 'readonly').objectStore('songs');
    const keys = await req<IDBValidKey[]>(store.getAllKeys());
    const values = await req<ArrayBuffer[]>(store.getAll());
    keys?.forEach((k, i) => values?.[i] && this.own.set(String(k), values[i]));
  }
}

function req<T>(r: IDBRequest): Promise<T | null> {
  return new Promise((ok) => {
    r.onsuccess = () => ok(r.result as T);
    r.onerror = () => ok(null);
  });
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('songs');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch {
      ok(null);
    }
  });
}
