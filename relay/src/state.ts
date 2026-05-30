import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import { relayConfig } from './config.js';

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
  joinAttemptsTimestamps: number[];
  messageBuffer: BufferedMessage[];
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

  if (!room.members.size) {
    rooms.delete(room.roomId);
  }
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
    joinAttemptsTimestamps: [],
    messageBuffer: [],
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

export const snapshotStats = () => ({
  roomCount: rooms.size,
  sessionCount: sessions.size,
  connectionsByIp: connectionCountByIp.size,
});
