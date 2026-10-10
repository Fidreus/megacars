// Tracker module renderer (Web Worker). Loading a module with libopenmpt can
// take 100 ms; doing that on the audio thread stalls every sound in the game,
// so it happens here. Rendered stereo chunks go straight to the 'pcm-player'
// worklet over a MessagePort, a few chunks ahead of playback.

import libopenmptPromise from '../vendor/libopenmpt/libopenmpt.js';

const CHUNK = 4096; // frames per chunk (~85 ms at 48 kHz)
const AHEAD = 4; // chunks queued in the worklet

let lib = null;
let out = null; // MessagePort to the worklet
let rate = 48000;
let mod = 0;
let id = 0;
let inFlight = 0;
let left = 0;
let right = 0;
const pending = [];

function cstr(s) {
  const p = lib._malloc(s.length + 1);
  for (let i = 0; i < s.length; i++) lib.HEAPU8[p + i] = s.charCodeAt(i);
  lib.HEAPU8[p + s.length] = 0;
  return p;
}

function ctl(key, value) {
  const k = cstr(key);
  const v = cstr(value);
  lib._openmpt_module_ctl_set(mod, k, v);
  lib._free(k);
  lib._free(v);
}

function unload() {
  if (mod) lib._openmpt_module_destroy(mod);
  mod = 0;
}

function load(bytes, separation) {
  unload();
  const data = new Uint8Array(bytes);
  const p = lib._malloc(data.length);
  lib.HEAPU8.set(data, p);
  mod = lib._openmpt_module_create_from_memory(p, data.length, 0, 0, 0);
  lib._free(p);
  if (!mod) {
    self.postMessage({ cmd: 'error', val: 'could not load module' });
    return;
  }
  ctl('render.resampler.emulate_amiga', '1');
  ctl('render.resampler.emulate_amiga_type', 'a1200');
  lib._openmpt_module_set_repeat_count(mod, -1);
  lib._openmpt_module_set_render_param(mod, 2, separation); // stereo separation %
}

function pump() {
  while (mod && inFlight < AHEAD) {
    const n = lib._openmpt_module_read_float_stereo(mod, rate, CHUNK, left, right);
    if (n === 0) {
      unload();
      break;
    }
    const l = lib.HEAPF32.slice(left / 4, left / 4 + n);
    const r = lib.HEAPF32.slice(right / 4, right / 4 + n);
    inFlight++;
    out.postMessage({ cmd: 'chunk', id, l, r }, [l.buffer, r.buffer]);
  }
}

function handle(msg) {
  if (msg.cmd === 'play') {
    id = msg.id;
    inFlight = 0;
    out.postMessage({ cmd: 'flush', id });
    load(msg.data, msg.separation ?? 70);
    pump();
  } else if (msg.cmd === 'stop') {
    id = msg.id;
    inFlight = 0;
    unload();
    out.postMessage({ cmd: 'flush', id });
  }
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.cmd === 'init') {
    out = msg.port;
    rate = msg.sampleRate;
    // The worklet reports each chunk it has played.
    out.onmessage = (m) => {
      if (m.data.cmd === 'used' && m.data.id === id) {
        inFlight = Math.max(0, inFlight - 1);
        pump();
      }
    };
    libopenmptPromise()
      .then((l) => {
        lib = l;
        left = lib._malloc(4 * CHUNK);
        right = lib._malloc(4 * CHUNK);
        self.postMessage({ cmd: 'ready' });
        for (const p of pending.splice(0)) handle(p);
      })
      .catch((err) => self.postMessage({ cmd: 'error', val: String(err) }));
    return;
  }
  if (!lib) pending.push(msg);
  else handle(msg);
};
