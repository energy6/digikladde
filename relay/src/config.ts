import type { RelayConfig } from './types.js';

const parseNumber = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePath = (pathValue: string) => {
  if (!pathValue.startsWith('/')) return `/${pathValue}`;
  return pathValue;
};

export const relayConfig: RelayConfig = {
  host: process.env.RELAY_HOST ?? '0.0.0.0',
  port: parseNumber('RELAY_PORT', 8080),
  wsPath: normalizePath(process.env.RELAY_WS_PATH ?? '/relay'),
  maxPayloadBytes: parseNumber('RELAY_MAX_PAYLOAD_BYTES', 128 * 1024),
  maxConnectionsPerIp: parseNumber('RELAY_MAX_CONNECTIONS_PER_IP', 40),
  maxEventsPerMinutePerIp: parseNumber('RELAY_MAX_EVENTS_PER_MINUTE_PER_IP', 1200),
  maxJoinPerMinutePerRoom: parseNumber('RELAY_MAX_JOIN_PER_MINUTE_PER_ROOM', 100),
  maxParticipantsPerRoom: parseNumber('RELAY_MAX_PARTICIPANTS_PER_ROOM', 40),
  heartbeatIntervalMs: parseNumber('RELAY_HEARTBEAT_INTERVAL_MS', 30000),
  idleTimeoutMs: parseNumber('RELAY_IDLE_TIMEOUT_MS', 120000),
  ticketTtlMs: parseNumber('RELAY_TICKET_TTL_MS', 15 * 60 * 1000),
  messageBufferLimitPerRoom: parseNumber('RELAY_MESSAGE_BUFFER_LIMIT_PER_ROOM', 100),
  queueRetentionMs: parseNumber('RELAY_QUEUE_RETENTION_MS', 24 * 60 * 60 * 1000),
  webPushPublicKey: process.env.RELAY_WEB_PUSH_PUBLIC_KEY?.trim() || undefined,
  webPushPrivateKey: process.env.RELAY_WEB_PUSH_PRIVATE_KEY?.trim() || undefined,
  webPushSubject: process.env.RELAY_WEB_PUSH_SUBJECT?.trim() || undefined,
};
