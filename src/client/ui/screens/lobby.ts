// Online screens: the room lobby (code, invite link, who is in, who is ready)
// and the connect screen's status line.

import type { RoomInfo } from '../../../shared/net/protocol.ts';
import type { ConnState } from '../../net/connection.ts';
import { drawText } from '../font.ts';

/** Draws the room header and player list; returns the y where the menu goes. */
export function drawLobby(ctx: CanvasRenderingContext2D, W: number, H: number, room: RoomInfo, me: number, time: number, summary = ''): number {
  const big = H >= 330 ? 3 : 2;
  let y = Math.round(H * 0.04);
  drawText(ctx, `${room.config.public ? 'PUBLIC' : 'PRIVATE'} ROOM ${room.code}`, W / 2, y, { scale: big, color: '#ffd84a', align: 'center' });
  y += 7 * big + 6;
  drawText(ctx, `INVITE: ${inviteLink(room.code)}`, W / 2, y, { color: '#9fd8ff', align: 'center' });
  y += 12;
  if (summary) {
    drawText(ctx, summary, W / 2, y, { color: '#ffffff', align: 'center' });
    y += 12;
  }
  y += 2;
  const tour = room.config.tour.length;
  // Standings: most points first once there are any.
  const players = room.races > 0 ? [...room.players].sort((a, b) => b.points - a.points) : room.players;
  if (tour > 1 && room.tourIndex >= tour) {
    const best = players[0];
    drawText(ctx, `TOURNAMENT OVER - WINNER: ${best?.name ?? '?'} WITH ${best?.points ?? 0} POINTS`, W / 2, y - 4, { color: Math.sin(time * 4) > -0.4 ? '#ffd84a' : '#ff9a1f', align: 'center' });
    y += 8;
  } else if (tour > 1) {
    const next = room.tourNames.slice(room.tourIndex + 1, room.tourIndex + 3).join(', ').toUpperCase();
    drawText(ctx, `TOURNAMENT: RACE ${room.tourIndex + 1} OF ${tour}${next ? ` - THEN ${next}${room.tourIndex + 3 < tour ? '...' : ''}` : ' - THE LAST ONE'}`, W / 2, y - 4, { color: '#c8d0dc', align: 'center' });
    y += 8;
  } else if (room.races > 0) {
    drawText(ctx, `SEASON: ${room.races} RACE${room.races === 1 ? '' : 'S'} RUN`, W / 2, y - 4, { color: '#c8d0dc', align: 'center' });
    y += 8;
  }

  const rowH = 11;
  const boxW = Math.min(W - 24, 300);
  const x0 = Math.round(W / 2 - boxW / 2);
  const boxH = 8 * rowH + 8;
  ctx.fillStyle = 'rgba(8,10,24,0.72)';
  ctx.fillRect(x0, y - 4, boxW, boxH);
  for (let i = 0; i < 8; i++) {
    const p = players[i];
    const ry = y + i * rowH;
    if (!p) {
      drawText(ctx, '- OPEN -', x0 + boxW / 2, ry, { color: '#3c4458', align: 'center', shadow: null });
      continue;
    }
    ctx.fillStyle = p.color;
    ctx.fillRect(x0 + 6, ry, 10, 7);
    const mine = p.id === me;
    drawText(ctx, `${p.name}${mine ? ' (YOU)' : ''}`, x0 + 22, ry, { color: p.connected ? (mine ? '#ffffff' : '#c8d0dc') : '#6a7488' });
    let status: string;
    let color: string;
    if (!p.connected) {
      status = 'DROPPED';
      color = '#ff6b5e';
    } else if (p.id === room.hostId && !room.config.public) {
      status = 'HOST';
      color = '#ffd84a';
    } else if (p.ready) {
      status = 'READY';
      color = '#9cff9c';
    } else {
      status = Math.sin(time * 4) > 0 ? 'NOT READY' : '';
      color = '#ff9a1f';
    }
    drawText(ctx, status, x0 + boxW - 92, ry, { color, align: 'right' });
    drawText(ctx, `${p.points}P`, x0 + boxW - 50, ry, { color: '#ffd84a', align: 'right' });
    if (p.ping >= 0) drawText(ctx, `${p.ping}MS`, x0 + boxW - 6, ry, { color: pingColor(p.ping), align: 'right' });
  }
  y += boxH + 4;
  // A dark strip so the status reads over the scenery.
  if (room.state === 'race' || room.startsIn > 0 || room.config.public) {
    ctx.fillStyle = 'rgba(8,10,24,0.72)';
    ctx.fillRect(x0, y - 3, boxW, 13);
  }
  if (room.state === 'race') {
    drawText(ctx, 'RACE IN PROGRESS - YOU ARE WATCHING UNTIL THE NEXT ONE', W / 2, y, { color: '#ffd84a', align: 'center' });
  } else if (room.startsIn > 0) {
    drawText(ctx, `EVERYBODY IS READY - THE RACE STARTS IN ${room.startsIn}`, W / 2, y, { color: '#9cff9c', align: 'center' });
  } else if (room.config.public) {
    const people = room.players.filter((p) => p.connected).length;
    const text = people < 2 ? 'WAITING FOR OTHER PLAYERS TO JOIN...' : 'STARTS BY ITSELF WHEN EVERYBODY IS READY';
    drawText(ctx, text, W / 2, y, { color: Math.sin(time * 3) > -0.3 ? '#ffd84a' : '#c8a838', align: 'center' });
  }
  return y + 16;
}

export function pingColor(ms: number): string {
  return ms < 80 ? '#9cff9c' : ms < 160 ? '#ffd84a' : '#ff6b5e';
}

export function inviteLink(code: string): string {
  return `${location.origin}/?room=${code}`;
}

export function connText(state: ConnState, rtt: number): { text: string; color: string } {
  switch (state) {
    case 'open':
      return { text: rtt >= 0 ? `ONLINE  ${Math.round(rtt)}MS` : 'ONLINE', color: '#9cff9c' };
    case 'connecting':
      return { text: 'CONNECTING...', color: '#ffd84a' };
    case 'retrying':
      return { text: 'RECONNECTING...', color: '#ff9a1f' };
    case 'failed':
      return { text: 'SERVER NOT REACHABLE', color: '#ff6b5e' };
    default:
      return { text: '', color: '#ffffff' };
  }
}
