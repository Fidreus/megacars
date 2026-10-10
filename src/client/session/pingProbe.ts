// Measures round-trip time to the game server over the WebSocket (/ws).

import { MsgType } from '../../shared/net/protocol.ts';

export class PingProbe {
  rtt = -1;
  connected = false;
  private ws: WebSocket | null = null;
  private timer = 0;

  start(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.connected = true;
      this.ping();
      this.timer = window.setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      const v = new DataView(ev.data);
      if (v.byteLength >= 9 && v.getUint8(0) === MsgType.Pong) {
        this.rtt = performance.now() - v.getFloat64(1, true);
      }
    };
    ws.onclose = () => {
      this.connected = false;
      clearInterval(this.timer);
    };
    this.ws = ws;
  }

  private ping(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const buf = new ArrayBuffer(9);
    const v = new DataView(buf);
    v.setUint8(0, MsgType.Ping);
    v.setFloat64(1, performance.now(), true);
    this.ws.send(buf);
  }
}
