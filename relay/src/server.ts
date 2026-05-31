import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { relayConfig } from './config.js';
import {
  attachSessionToRoom,
  bufferMessage,
  canOpenConnectionForIp,
  createSession,
  deleteSession,
  getOrCreateRoom,
  getRoom,
  getRoomSessions,
  getRoomSessionsByDevice,
  markEventAndCheckRate,
  registerJoinAttemptAndCheckLimit,
  snapshotStats,
  type Session,
} from './state.js';
import type { JoinRequestPayload, RelayEnvelope, RelayErrorCode } from './types.js';

const forwardableTypes = new Set([
  'peer_key_request',
  'peer_key_response',
  'sync_request',
  'sync_response',
  'rekey_prepare',
  'rekey_ack',
  'rekey_commit',
]);

const now = () => Date.now();
const sessionsBySocket = new WeakMap<WebSocket, Session>();

const log = (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(context ?? {}),
  };
  const serialized = JSON.stringify(payload);
  if (level === 'error') console.error(serialized);
  else if (level === 'warn') console.warn(serialized);
  else console.log(serialized);
};

const send = (session: Session, envelope: RelayEnvelope) => {
  if (session.ws.readyState !== session.ws.OPEN) return;
  session.ws.send(JSON.stringify(envelope));
};

const sendError = (session: Session, code: RelayErrorCode, message: string, close = false) => {
  send(session, {
    version: 1,
    type: 'error',
    payload: { code, message },
  });

  if (close) {
    session.ws.close(1008, message);
  }
};

const parseEnvelope = (raw: string): RelayEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as RelayEnvelope;
    if (!parsed || parsed.version !== 1 || typeof parsed.type !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
};

const requireJoinedSession = (session: Session, envelope: RelayEnvelope): { roomId: string; deviceId: string } | null => {
  if (!session.roomId || !session.deviceId || !session.ticket || !session.ticketExpiresAt) {
    sendError(session, 'not_joined', 'Session ist keinem Raum beigetreten.');
    return null;
  }

  if (envelope.roomId !== session.roomId || envelope.deviceId !== session.deviceId) {
    sendError(session, 'invalid_event', 'roomId oder deviceId stimmt nicht mit der Session ueberein.');
    return null;
  }

  if (envelope.ticket !== session.ticket || session.ticketExpiresAt <= now()) {
    sendError(session, 'invalid_ticket', 'Ticket ungueltig oder abgelaufen.', true);
    return null;
  }

  return { roomId: session.roomId, deviceId: session.deviceId };
};

const handleJoinRequest = (session: Session, envelope: RelayEnvelope) => {
  const payload = envelope.payload as Partial<JoinRequestPayload> | undefined;
  const roomId = payload?.roomId?.trim();
  const deviceId = payload?.deviceId?.trim();
  const joinSecret = payload?.joinSecret?.trim();

  if (!roomId || !deviceId || !joinSecret) {
    sendError(session, 'invalid_event', 'join_request ist unvollstaendig.', true);
    return;
  }

  const room = getOrCreateRoom(roomId, joinSecret);

  if (!registerJoinAttemptAndCheckLimit(room)) {
    sendError(session, 'rate_limited', 'Zu viele Join-Versuche fuer diesen Raum.', true);
    return;
  }

  if (room.joinSecret !== joinSecret) {
    send(session, {
      version: 1,
      type: 'join_denied',
      roomId,
      deviceId,
      payload: { reason: 'join_secret_mismatch' },
    });
    session.ws.close(1008, 'Join denied');
    return;
  }

  if (room.members.size >= relayConfig.maxParticipantsPerRoom) {
    sendError(session, 'room_full', 'Raum ist voll.', true);
    return;
  }

  const ticket = randomUUID();
  const ticketExpiresAt = now() + relayConfig.ticketTtlMs;
  attachSessionToRoom(session, room, deviceId, ticket, ticketExpiresAt);

  send(session, {
    version: 1,
    type: 'join_ok',
    roomId,
    deviceId,
    ticket,
    payload: {
      ticketExpiresAt,
      serverTime: now(),
      wsPath: relayConfig.wsPath,
    },
  });

  log('info', 'client joined room', { roomId, deviceId, sessionId: session.id });
};

const handleTicketRefresh = (session: Session, envelope: RelayEnvelope) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  session.ticket = randomUUID();
  session.ticketExpiresAt = now() + relayConfig.ticketTtlMs;

  send(session, {
    version: 1,
    type: 'ticket_refresh',
    roomId: joined.roomId,
    deviceId: joined.deviceId,
    ticket: session.ticket,
    payload: {
      ticketExpiresAt: session.ticketExpiresAt,
      serverTime: now(),
    },
  });
};

const forwardEvent = (session: Session, envelope: RelayEnvelope) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  if (!forwardableTypes.has(envelope.type)) {
    sendError(session, 'invalid_event', `Event-Typ ${envelope.type} wird nicht weitergeleitet.`);
    return;
  }

  const room = getRoom(joined.roomId);
  if (!room) {
    sendError(session, 'invalid_event', 'Raum wurde nicht gefunden.', true);
    return;
  }

  const recipients = envelope.targetDeviceId
    ? getRoomSessionsByDevice(room, envelope.targetDeviceId)
    : getRoomSessions(room);

  const outbound: RelayEnvelope = {
    ...envelope,
    roomId: joined.roomId,
    deviceId: joined.deviceId,
    ticket: undefined,
  };

  recipients.forEach((candidate) => {
    if (candidate.id === session.id) return;
    send(candidate, outbound);
  });

  bufferMessage(room, {
    ts: now(),
    fromDeviceId: joined.deviceId,
    type: envelope.type,
    payload: envelope.payload,
  });
};

const httpServer = createServer((req, res) => {
  const reqUrl = req.url ?? '/';
  const url = new URL(reqUrl, `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    const health = {
      status: 'ok',
      uptimeSec: Math.round(process.uptime()),
      stats: snapshotStats(),
      wsPath: relayConfig.wsPath,
    };
    const body = JSON.stringify(health);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }

  if (url.pathname === '/metrics') {
    const stats = snapshotStats();
    const body = JSON.stringify(stats);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: relayConfig.maxPayloadBytes,
  perMessageDeflate: false,
});

httpServer.on('upgrade', (req, socket, head) => {
  const reqUrl = req.url ?? '/';
  const url = new URL(reqUrl, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== relayConfig.wsPath) {
    socket.write('HTTP/1.1 404 Not Found\\r\\n\\r\\n');
    socket.destroy();
    return;
  }

  const rawIp = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim()
    ?? req.socket.remoteAddress
    ?? 'unknown';

  if (!canOpenConnectionForIp(rawIp)) {
    socket.write('HTTP/1.1 429 Too Many Requests\\r\\n\\r\\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    const session = createSession(ws, rawIp);
    wss.emit('connection', ws, session);
  });
});

wss.on('connection', (ws, session: Session) => {
  sessionsBySocket.set(ws, session);

  ws.on('pong', () => {
    session.lastSeenAt = now();
  });

  ws.on('message', (raw) => {
    session.lastSeenAt = now();

    if (!markEventAndCheckRate(session.ip)) {
      sendError(session, 'rate_limited', 'Event-Rate-Limit ueberschritten.', true);
      return;
    }

    const rawText = typeof raw === 'string'
      ? raw
      : Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString('utf8')
          : Buffer.from(new Uint8Array(raw)).toString('utf8');

    const parsed = parseEnvelope(rawText);
    if (!parsed) {
      sendError(session, 'invalid_json', 'Nachricht ist kein gueltiges Relay-JSON.');
      return;
    }

    if (parsed.type === 'join_request') {
      handleJoinRequest(session, parsed);
      return;
    }

    if (parsed.type === 'ticket_refresh') {
      handleTicketRefresh(session, parsed);
      return;
    }

    forwardEvent(session, parsed);
  });

  ws.on('close', () => {
    log('info', 'client disconnected', {
      sessionId: session.id,
      roomId: session.roomId,
      deviceId: session.deviceId,
    });
    deleteSession(session);
  });

  ws.on('error', (error) => {
    log('warn', 'websocket error', { sessionId: session.id, error: String(error) });
  });
});

const heartbeatHandle = setInterval(() => {
  wss.clients.forEach((client) => {
    const session = sessionsBySocket.get(client);
    if (session && session.lastSeenAt <= now() - relayConfig.idleTimeoutMs) {
      session.ws.close(1001, 'idle timeout');
      return;
    }

    client.ping();
  });
}, relayConfig.heartbeatIntervalMs);

httpServer.listen(relayConfig.port, relayConfig.host, () => {
  log('info', 'relay server started', {
    host: relayConfig.host,
    port: relayConfig.port,
    wsPath: relayConfig.wsPath,
  });
});

const shutdown = (signal: string) => {
  log('info', 'shutdown initiated', { signal });
  clearInterval(heartbeatHandle);

  wss.clients.forEach((client) => {
    client.close(1001, 'server shutdown');
  });

  httpServer.close(() => {
    log('info', 'relay server stopped');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
