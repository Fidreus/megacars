// Plays stereo chunks rendered by mod-worker.js. Only copies samples on the
// audio thread, so it never stalls other sounds. Silence when it runs dry.

class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.pos = 0;
    this.id = 0;
    this.started = -1;
    this.worker = null;
    this.port.onmessage = (e) => {
      if (e.data.cmd === 'init') {
        this.worker = e.data.port;
        this.worker.onmessage = (m) => this.receive(m.data);
      }
    };
  }

  receive(msg) {
    if (msg.cmd === 'flush') {
      this.queue.length = 0;
      this.pos = 0;
      this.id = msg.id;
    } else if (msg.cmd === 'chunk' && msg.id === this.id) {
      this.queue.push(msg);
    }
  }

  process(_inputs, outputs) {
    const l = outputs[0][0];
    const r = outputs[0][1] ?? l;
    let i = 0;
    while (i < l.length && this.queue.length) {
      const c = this.queue[0];
      const n = Math.min(l.length - i, c.l.length - this.pos);
      l.set(c.l.subarray(this.pos, this.pos + n), i);
      r.set(c.r.subarray(this.pos, this.pos + n), i);
      i += n;
      this.pos += n;
      if (this.started !== c.id) {
        this.started = c.id;
        this.port.postMessage({ cmd: 'started', id: c.id });
      }
      if (this.pos >= c.l.length) {
        this.queue.shift();
        this.pos = 0;
        this.worker?.postMessage({ cmd: 'used', id: c.id });
      }
    }
    if (i < l.length) {
      l.fill(0, i);
      r.fill(0, i);
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
