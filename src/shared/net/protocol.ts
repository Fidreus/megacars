// Wire protocol. Binary messages start with a one-byte type; JSON messages
// are sent as text frames.

export const MsgType = {
  Input: 1,
  Ping: 2,
  Snapshot: 3,
  Pong: 4,
} as const;
