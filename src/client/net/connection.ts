// The WebSocket to the game server: JSON control messages, binary game data,
// round-trip measurement, and reconnecting (with the same identity) when the
// connection drops.

import { MsgType, PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '../../shared/net/protocol.ts';

const TOKEN_KEY = 'megacars.token';

export type ConnState = 'idle' | 'connecting' | 'open' | 'retrying' | 'failed';

export interface ConnectionEvents {
  message(msg: ServerMsg): void;
  binary(data: Uint8Array): void;
  state(state: ConnState): void;
}

export class Connection {
  state: ConnState = 'idle';
  /** Smoothed round-trip time in ms (-1 until measured). */
  rtt = -1;
  /** Our player id once the server has welcomed us. */
  id = -1;
  name: string;
  private ws: WebSocket | null = null;
  private readonly events: ConnectionEvents;
  private pingTimer = 0;
  private retryTimer = 0;
  private attempts = 0;
  private wanted = false;
  private readonly pingBuf = new ArrayBuffer(9);

  constructor(name: string, events: ConnectionEvents) {
    this.name = name;
    this.events = events;
  }

  get online(): boolean {
    return this.state === 'open' && this.id >= 0;
  }

  connect(): void {
    this.wanted = true;
    if (this.ws) return;
    this.open();
  }

  /** Stop and stay disconnected. */
  close(): void {
    this.wanted = false;
    clearTimeout(this.retryTimer);
    this.ws?.close(1000, 'bye');
    this.ws = null;
    this.setState('idle');
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  sendBinary(data: Uint8Array): void {
    // send() copies the bytes, so callers may reuse their buffer.
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data as Uint8Array<ArrayBuffer>);
  }

  private open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.id = -1;
    this.setState(this.attempts > 0 ? 'retrying' : 'connecting');
    ws.onopen = () => {
      this.attempts = 0;
      let token: string | undefined;
      try {
        token = sessionStorage.getItem(TOKEN_KEY) ?? undefined;
      } catch {
        // No storage: we just get a new identity.
      }
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, token });
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 1000);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        const data = new Uint8Array(ev.data);
        if (data[0] === MsgType.Pong && data.byteLength >= 9) {
          const rtt = performance.now() - new DataView(ev.data).getFloat64(1, true);
          this.rtt = this.rtt < 0 ? rtt : this.rtt * 0.8 + rtt * 0.2;
        } else {
          this.events.binary(data);
        }
        return;
      }
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        try {
          sessionStorage.setItem(TOKEN_KEY, msg.token);
        } catch {
          // Reconnecting will just start over.
        }
        this.setState('open');
      } else if (msg.t === 'error' && msg.code === 'version') {
        this.wanted = false;
        this.setState('failed');
      }
      this.events.message(msg);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.ws = null;
      this.id = -1;
      if (!this.wanted) {
        this.setState(this.state === 'failed' ? 'failed' : 'idle');
        return;
      }
      // Back off: 0.5 s, 1 s, 2 s ... up to 8 s; give up after about a minute.
      this.attempts++;
      if (this.attempts > 12) {
        this.setState('failed');
        return;
      }
      this.setState('retrying');
      this.retryTimer = window.setTimeout(() => this.open(), Math.min(8000, 250 * 2 ** this.attempts));
    };
  }

  private ping(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const v = new DataView(this.pingBuf);
    v.setUint8(0, MsgType.Ping);
    v.setFloat64(1, performance.now(), true);
    this.ws.send(this.pingBuf);
  }

  private setState(s: ConnState): void {
    if (s === this.state) return;
    this.state = s;
    this.events.state(s);
  }
}
