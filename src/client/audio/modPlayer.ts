// Tracker module player. libopenmpt runs in a Web Worker (/audio/mod-worker.js)
// that renders ahead; a tiny AudioWorklet (/audio/pcm-worklet.js) only plays
// the rendered chunks. Loading a module never blocks the audio thread, so the
// engines and effects keep playing smoothly while songs change.

export class ModPlayer {
  readonly output: AudioWorkletNode;
  /** Called when the latest song's first samples reach the speakers. */
  onStarted: (() => void) | null = null;
  private readonly worker: Worker;
  private id = 0;

  private constructor(node: AudioWorkletNode, worker: Worker) {
    this.output = node;
    this.worker = worker;
    node.port.onmessage = (e: MessageEvent<{ cmd: string; id: number }>) => {
      if (e.data.cmd === 'started' && e.data.id === this.id) this.onStarted?.();
    };
  }

  static async create(ctx: AudioContext): Promise<ModPlayer> {
    await ctx.audioWorklet.addModule('/audio/pcm-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const worker = new Worker('/audio/mod-worker.js', { type: 'module' });
    const channel = new MessageChannel();
    node.port.postMessage({ cmd: 'init', port: channel.port2 }, [channel.port2]);
    worker.postMessage({ cmd: 'init', port: channel.port1, sampleRate: ctx.sampleRate }, [channel.port1]);
    await new Promise<void>((ok, fail) => {
      worker.onmessage = (e: MessageEvent<{ cmd: string; val?: string }>) => {
        if (e.data.cmd === 'ready') ok();
        else if (e.data.cmd === 'error') fail(new Error(e.data.val));
      };
      worker.onerror = (e) => fail(new Error(e.message));
      setTimeout(() => fail(new Error('music worker timeout')), 10000);
    });
    worker.onmessage = (e: MessageEvent<{ cmd: string; val?: string }>) => {
      if (e.data.cmd === 'error') console.warn('Music:', e.data.val);
    };
    return new ModPlayer(node, worker);
  }

  play(data: ArrayBuffer): void {
    const copy = data.slice(0);
    this.worker.postMessage({ cmd: 'play', id: ++this.id, data: copy, separation: 70 }, [copy]);
  }

  stop(): void {
    this.worker.postMessage({ cmd: 'stop', id: ++this.id });
  }
}
