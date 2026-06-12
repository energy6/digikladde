import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { relayConfig } from './config.js';
import type { PushSubscriptionPayload, QueuedRelayMessage } from './types.js';

export type Session = {
  id: string;
  ws: WebSocket;
  ip: string;
  deviceId?: string;
  roomId?: string;
  ticket?: string;
  ticketExpiresAt?: number;
  lastSeenAt: number;
};

export type BufferedMessage = {
  ts: number;
  fromDeviceId?: string;
  type: string;
  payload?: Record<string, unknown>;
};

export type RoomState = {
  roomId: string;
  joinSecret: string;
  members: Set<string>; // session IDs
  byDeviceId: Map<string, Set<string>>; // device -> session IDs
  knownDevices: Set<string>;
  inboxesByDeviceId: Map<string, QueuedRelayMessage[]>;
  nextQueueSeqByDeviceId: Map<string, number>;
  pushSubscriptionsByDeviceId: Map<string, PushSubscriptionPayload>;
  joinAttemptsTimestamps: number[];
  messageBuffer: BufferedMessage[];
  lastActiveAt: number;
};

const rooms = new Map<string, RoomState>();
const sessions = new Map<string, Session>();

const connectionCountByIp = new Map<string, number>();
const eventTimestampsByIp = new Map<string, number[]>();

const pruneOlderThanMinute = (timestamps: number[], now: number) => {
  const oneMinuteAgo = now - 60_000;
  while (timestamps.length && timestamps[0] < oneMinuteAgo) {
    timestamps.shift();
  }
};

export const createSession = (ws: WebSocket, ip: string): Session => {
  const session: Session = {
    id: randomUUID(),
    ws,
    ip,
    lastSeenAt: Date.now(),
  };
  sessions.set(session.id, session);
  connectionCountByIp.set(ip, (connectionCountByIp.get(ip) ?? 0) + 1);
  return session;
};

export const deleteSession = (session: Session) => {
  const disconnectedAt = Date.now();
  sessions.delete(session.id);
  const currentConnections = connectionCountByIp.get(session.ip) ?? 0;
  if (currentConnections <= 1) connectionCountByIp.delete(session.ip);
  else connectionCountByIp.set(session.ip, currentConnections - 1);

  if (!session.roomId) return;
  const room = rooms.get(session.roomId);
  if (!room) return;

  room.members.delete(session.id);
  if (session.deviceId) {
    const entries = room.byDeviceId.get(session.deviceId);
    if (entries) {
      entries.delete(session.id);
      if (!entries.size) room.byDeviceId.delete(session.deviceId);
    }
  }

  room.lastActiveAt = disconnectedAt;
};

export const canOpenConnectionForIp = (ip: string) => {
  const current = connectionCountByIp.get(ip) ?? 0;
  return current < relayConfig.maxConnectionsPerIp;
};

export const markEventAndCheckRate = (ip: string, now = Date.now()) => {
  const timestamps = eventTimestampsByIp.get(ip) ?? [];
  pruneOlderThanMinute(timestamps, now);
  if (timestamps.length >= relayConfig.maxEventsPerMinutePerIp) {
    eventTimestampsByIp.set(ip, timestamps);
    return false;
  }
  timestamps.push(now);
  eventTimestampsByIp.set(ip, timestamps);
  return true;
};

export const getOrCreateRoom = (roomId: string, joinSecret: string): RoomState => {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const created: RoomState = {
    roomId,
    joinSecret,
    members: new Set<string>(),
    byDeviceId: new Map<string, Set<string>>(),
    knownDevices: new Set<string>(),
    inboxesByDeviceId: new Map<string, QueuedRelayMessage[]>(),
    nextQueueSeqByDeviceId: new Map<string, number>(),
    pushSubscriptionsByDeviceId: new Map<string, PushSubscriptionPayload>(),
    joinAttemptsTimestamps: [],
    messageBuffer: [],
    lastActiveAt: Date.now(),
  };
  rooms.set(roomId, created);
  return created;
};

export const registerJoinAttemptAndCheckLimit = (room: RoomState, now = Date.now()) => {
  pruneOlderThanMinute(room.joinAttemptsTimestamps, now);
  if (room.joinAttemptsTimestamps.length >= relayConfig.maxJoinPerMinutePerRoom) {
    return false;
  }
  room.joinAttemptsTimestamps.push(now);
  return true;
};

export const attachSessionToRoom = (session: Session, room: RoomState, deviceId: string, ticket: string, ticketExpiresAt: number) => {
  session.roomId = room.roomId;
  session.deviceId = deviceId;
  session.ticket = ticket;
  session.ticketExpiresAt = ticketExpiresAt;

  room.members.add(session.id);
  room.knownDevices.add(deviceId);
  room.lastActiveAt = Date.now();
  const bucket = room.byDeviceId.get(deviceId) ?? new Set<string>();
  bucket.add(session.id);
  room.byDeviceId.set(deviceId, bucket);
};

export const getRoom = (roomId: string) => rooms.get(roomId);

export const getSession = (sessionId: string) => sessions.get(sessionId);

export const getRoomSessions = (room: RoomState) => Array.from(room.members)
  .map((sessionId) => sessions.get(sessionId))
  .filter((value): value is Session => Boolean(value));

export const getRoomSessionsByDevice = (room: RoomState, deviceId: string) => {
  const ids = room.byDeviceId.get(deviceId);
  if (!ids) return [];
  return Array.from(ids)
    .map((sessionId) => sessions.get(sessionId))
    .filter((value): value is Session => Boolean(value));
};

export const bufferMessage = (room: RoomState, message: BufferedMessage) => {
  room.messageBuffer.push(message);
  const overflow = room.messageBuffer.length - relayConfig.messageBufferLimitPerRoom;
  if (overflow > 0) {
    room.messageBuffer.splice(0, overflow);
  }
};

export const queueMessageForDevice = (
  room: RoomState,
  targetDeviceId: string,
  message: Omit<QueuedRelayMessage, 'seq'>,
) => {
  const seq = room.nextQueueSeqByDeviceId.get(targetDeviceId) ?? 1;
  const queued: QueuedRelayMessage = {
    ...message,
    seq,
  };

  const inbox = room.inboxesByDeviceId.get(targetDeviceId) ?? [];
  inbox.push(queued);
  room.inboxesByDeviceId.set(targetDeviceId, inbox);
  room.nextQueueSeqByDeviceId.set(targetDeviceId, seq + 1);
  room.lastActiveAt = Date.now();

  return queued;
};

export const listQueuedMessagesForDevice = (room: RoomState, deviceId: string, afterSeq: number) => {
  const inbox = room.inboxesByDeviceId.get(deviceId) ?? [];
  return inbox.filter((message) => message.seq > afterSeq);
};

export const ackQueuedMessagesForDevice = (room: RoomState, deviceId: string, throughSeq: number) => {
  const inbox = room.inboxesByDeviceId.get(deviceId);
  if (!inbox) return;

  const remaining = inbox.filter((message) => message.seq > throughSeq);
  if (remaining.length) {
    room.inboxesByDeviceId.set(deviceId, remaining);
  } else {
    room.inboxesByDeviceId.delete(deviceId);
  }

  room.lastActiveAt = Date.now();
};

export const setPushSubscriptionForDevice = (
  room: RoomState,
  deviceId: string,
  subscription: PushSubscriptionPayload,
) => {
  room.knownDevices.add(deviceId);
  room.pushSubscriptionsByDeviceId.set(deviceId, subscription);
  room.lastActiveAt = Date.now();
};

export const deletePushSubscriptionForDevice = (room: RoomState, deviceId: string) => {
  room.pushSubscriptionsByDeviceId.delete(deviceId);
  room.lastActiveAt = Date.now();
};

export const getPushSubscriptionForDevice = (room: RoomState, deviceId: string) => {
  return room.pushSubscriptionsByDeviceId.get(deviceId);
};

export const deletePushSubscriptionByEndpoint = (endpoint: string) => {
  rooms.forEach((room) => {
    room.pushSubscriptionsByDeviceId.forEach((subscription, deviceId) => {
      if (subscription.endpoint === endpoint) {
        room.pushSubscriptionsByDeviceId.delete(deviceId);
      }
    });
  });
};

export const pruneExpiredRoomState = (now = Date.now()) => {
  rooms.forEach((room) => {
    room.inboxesByDeviceId.forEach((inbox, deviceId) => {
      const retained = inbox.filter((message) => message.ts > now - relayConfig.queueRetentionMs);
      if (retained.length) {
        room.inboxesByDeviceId.set(deviceId, retained);
      } else {
        room.inboxesByDeviceId.delete(deviceId);
      }
    });

    if (
      !room.members.size
      && room.lastActiveAt <= now - relayConfig.queueRetentionMs
      && room.inboxesByDeviceId.size === 0
    ) {
      rooms.delete(room.roomId);
    }
  });
};

export const snapshotStats = () => ({
  roomCount: rooms.size,
  sessionCount: sessions.size,
  connectionsByIp: connectionCountByIp.size,
  queuedMessageCount: Array.from(rooms.values()).reduce((total, room) => (
    total + Array.from(room.inboxesByDeviceId.values()).reduce((roomTotal, inbox) => roomTotal + inbox.length, 0)
  ), 0),
  pushSubscriptionCount: Array.from(rooms.values()).reduce((total, room) => total + room.pushSubscriptionsByDeviceId.size, 0),
});

export const resetStateForTests = () => {
  rooms.clear();
  sessions.clear();
  connectionCountByIp.clear();
  eventTimestampsByIp.clear();
};
