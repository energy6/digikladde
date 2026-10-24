import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import webPush from 'web-push';
import { relayConfig } from './config.js';
import { clientEnvelopeSchema, invitationCreateSchema, invitationRedeemSchema, type ClientMessage } from './protocol.js';
import { consumeInvitation, pruneInvitations, storeInvitation } from './encryptedProtocol.js';
import {
  ackQueuedMessagesForDevice,
  attachSessionToRoom,
  bufferMessage,
  canOpenConnectionForIp,
  createSession,
  deletePushSubscriptionByEndpoint,
  deletePushSubscriptionForDevice,
  deleteSession,
  getPushSubscriptionForDevice,
  getOrCreateRoom,
  getRoom,
  getRoomSessions,
  getRoomSessionsByDevice,
  listQueuedMessagesForDevice,
  markDeltaDeliveredToDevice,
  markEventAndCheckRate,
  pruneExpiredRoomState,
  queueMessageForDevice,
  registerJoinAttemptAndCheckLimit,
  setPushSubscriptionForDevice,
  snapshotStats,
  type Session,
} from './state.js';
import type {
  RelayEnvelope,
  RelayErrorCode,
} from './types.js';

const webPushEnabled = Boolean(
  relayConfig.webPushPublicKey
  && relayConfig.webPushPrivateKey
  && relayConfig.webPushSubject,
);

if (webPushEnabled) {
  webPush.setVapidDetails(
    relayConfig.webPushSubject!,
    relayConfig.webPushPublicKey!,
    relayConfig.webPushPrivateKey!,
  );
}

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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const send = (session: Session, envelope: RelayEnvelope) => {
  if (session.ws.readyState !== session.ws.OPEN) return;
  session.ws.send(JSON.stringify(envelope));
};

const sendError = (session: Session, code: RelayErrorCode, message: string, close = false) => {
  send(session, {
    version: 2,
    type: 'error',
    payload: { code, message },
  });

  if (close) {
    session.ws.close(1008, message);
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

const handleJoinRequest = (session: Session, envelope: ClientMessage<'join_request'>) => {
  const { roomId, deviceId, joinSecret } = envelope.payload;

  const room = getOrCreateRoom(roomId, joinSecret);

  if (!registerJoinAttemptAndCheckLimit(room)) {
    sendError(session, 'rate_limited', 'Zu viele Join-Versuche fuer diesen Raum.', true);
    return;
  }

  if (room.joinSecret !== joinSecret) {
    send(session, {
      version: 2,
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
    version: 2,
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
    version: 2,
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

const handleCatchupRequest = (session: Session, envelope: ClientMessage<'catchup_request'>) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  const room = getRoom(joined.roomId);
  if (!room) {
    sendError(session, 'invalid_event', 'Raum wurde nicht gefunden.', true);
    return;
  }

  const afterSeq = envelope.payload?.afterSeq ?? 0;
  const messages = listQueuedMessagesForDevice(room, joined.deviceId, afterSeq);

  send(session, {
    version: 2,
    type: 'catchup_response',
    roomId: joined.roomId,
    deviceId: joined.deviceId,
    payload: { messages },
  });
};

const handleCatchupAck = (session: Session, envelope: ClientMessage<'catchup_ack'>) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  const room = getRoom(joined.roomId);
  if (!room) return;

  ackQueuedMessagesForDevice(room, joined.deviceId, envelope.payload.throughSeq);
};

const handlePushSubscribe = (session: Session, envelope: ClientMessage<'push_subscribe'>) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  const room = getRoom(joined.roomId);
  if (!room) {
    sendError(session, 'invalid_event', 'Raum wurde nicht gefunden.', true);
    return;
  }

  setPushSubscriptionForDevice(room, joined.deviceId, envelope.payload.subscription);
};

const handlePushUnsubscribe = (session: Session, envelope: RelayEnvelope) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  const room = getRoom(joined.roomId);
  if (!room) return;
  deletePushSubscriptionForDevice(room, joined.deviceId);
};

const sendQueuedUpdatePush = async (roomId: string, deviceId: string, messagePayload: Record<string, unknown>) => {
  if (!webPushEnabled) return;

  const room = getRoom(roomId);
  const subscription = room ? getPushSubscriptionForDevice(room, deviceId) : undefined;
  if (!subscription) return;

  try {
    await webPush.sendNotification(subscription, JSON.stringify({
      version: 2,
      roomId,
      ...(messagePayload.push ? { box: messagePayload.push } : {}),
    }));
  } catch (error) {
    const statusCode = isRecord(error) && typeof error.statusCode === 'number' ? error.statusCode : undefined;
    if (statusCode === 404 || statusCode === 410) {
      deletePushSubscriptionByEndpoint(subscription.endpoint);
      return;
    }

    log('warn', 'web push failed', { roomId, deviceId, error: String(error) });
  }
};

const forwardEvent = (session: Session, envelope: ClientMessage<'sync_request' | 'sync_response'>) => {
  const joined = requireJoinedSession(session, envelope);
  if (!joined) return;

  const { box, push } = envelope.payload;
  if (box.roomId !== joined.roomId || box.deviceId !== joined.deviceId
    || (envelope.type === 'sync_request' ? box.purpose !== 'snapshot_request' : !['delta', 'snapshot'].includes(box.purpose))
    || (push !== undefined && (push.purpose !== 'push' || box.purpose !== 'delta'
      || push.roomId !== box.roomId || push.courseSyncId !== box.courseSyncId
      || push.deviceId !== box.deviceId || push.epoch !== box.epoch || push.messageId !== box.messageId
      || Buffer.byteLength(JSON.stringify(push)) > 2800))) {
    sendError(session, 'invalid_event', 'Nur verschlüsselte V2-Nachrichten sind erlaubt.');
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
  const deltaOpId = envelope.type === 'sync_response' && box.purpose === 'delta' ? box.messageId : undefined;
  const deliverableDirectDevices = new Set<string>();
  const blockedDirectDevices = new Set<string>();

  recipients.forEach((candidate) => {
    if (candidate.id === session.id) return;
    if (deltaOpId && candidate.deviceId && candidate.deviceId !== joined.deviceId) {
      if (!deliverableDirectDevices.has(candidate.deviceId) && !blockedDirectDevices.has(candidate.deviceId)) {
        const accepted = markDeltaDeliveredToDevice(room, candidate.deviceId, deltaOpId, now());
        if (accepted) deliverableDirectDevices.add(candidate.deviceId);
        else blockedDirectDevices.add(candidate.deviceId);
      }

      if (blockedDirectDevices.has(candidate.deviceId)) return;
    }

    send(candidate, outbound);
  });

  if (deltaOpId) {
    const targetDeviceIds = envelope.targetDeviceId
      ? [envelope.targetDeviceId]
      : Array.from(room.knownDevices);

    targetDeviceIds
      .filter((deviceId) => deviceId !== joined.deviceId)
      .forEach((targetDeviceId) => {
        const queued = queueMessageForDevice(room, targetDeviceId, {
          ts: now(),
          fromDeviceId: joined.deviceId,
          type: 'sync_response',
          payload: envelope.payload,
        }, deltaOpId);

        if (!queued) return;

        const onlineSessions = getRoomSessionsByDevice(room, targetDeviceId);
        if (onlineSessions.length === 0) {
          void sendQueuedUpdatePush(joined.roomId, targetDeviceId, envelope.payload);
        }
      });
  }

  bufferMessage(room, {
    ts: now(),
    fromDeviceId: joined.deviceId,
    type: envelope.type,
    payload: envelope.payload,
  });
};

const handleInvitationRequest = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST' || !markEventAndCheckRate(req.socket.remoteAddress ?? 'unknown')) {
    res.writeHead(req.method === 'POST' ? 429 : 405);
    res.end(JSON.stringify({ error: 'request_denied' }));
    return;
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const rawChunk of req) {
    const chunk: unknown = rawChunk;
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) throw new TypeError('Unexpected request chunk');
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 8192) {
      res.writeHead(413); res.end(JSON.stringify({ error: 'too_large' })); return;
    }
    chunks.push(buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_json' })); return;
  }
  if (path === '/invites/redeem') {
    const parsed = invitationRedeemSchema.safeParse(body);
    if (!parsed.success) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_invite' })); return;
    }
    const result = consumeInvitation(parsed.data.inviteId);
    res.writeHead('error' in result ? 410 : 200);
    res.end(JSON.stringify({ ...result, serverTime: now() }));
    return;
  }
  const parsed = invitationCreateSchema.safeParse(body);
  if (!parsed.success) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_invite' })); return;
  }
  const invitation = parsed.data;
  const room = getRoom(invitation.roomId);
  const authorized = room && getRoomSessions(room).some((entry) => (
    entry.deviceId === invitation.deviceId && entry.ticket === invitation.ticket
    && entry.ticketExpiresAt !== undefined && entry.ticketExpiresAt > now()
  ));
  if (!authorized || !room) {
    res.writeHead(403); res.end(JSON.stringify({ error: 'not_joined' })); return;
  }
  if (invitation.box.deviceId !== invitation.deviceId
    || !storeInvitation(invitation.inviteId, { roomId: room.roomId, box: invitation.box, expiresAt: invitation.expiresAt })) {
    res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_invite' })); return;
  }
  res.writeHead(201); res.end(JSON.stringify({ created: true }));
};

const httpServer = createServer((req, res) => {
  const reqUrl = req.url ?? '/';
  const url = new URL(reqUrl, `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname === '/invites' || url.pathname === '/invites/redeem') {
    void handleInvitationRequest(req, res, url.pathname).catch(() => {
      log('error', 'invitation request failed');
      if (!res.headersSent) res.writeHead(500);
      res.end(JSON.stringify({ error: 'internal_error' }));
    });
    return;
  }

  if (url.pathname === '/health') {
    const health = {
      status: 'ok',
      serverTime: now(),
      uptimeSec: Math.round(process.uptime()),
      stats: snapshotStats(),
      wsPath: relayConfig.wsPath,
    };
    const body = JSON.stringify(health);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }

  if (url.pathname === '/push/vapid-public-key') {
    const body = JSON.stringify({
      enabled: webPushEnabled,
      publicKey: relayConfig.webPushPublicKey ?? null,
    });
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
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

  const handleMessage = (raw: RawData) => {
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

    let input: unknown;
    try {
      input = JSON.parse(rawText);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      sendError(session, 'invalid_json', 'Nachricht ist kein gueltiges Relay-JSON.');
      return;
    }

    const result = clientEnvelopeSchema.safeParse(input);
    if (!result.success) {
      sendError(session, 'invalid_event', 'Nachricht entspricht nicht dem Relay-Protokoll.');
      return;
    }
    const parsed = result.data;

    if (parsed.type === 'join_request') {
      handleJoinRequest(session, parsed);
      return;
    }

    if (parsed.type === 'ticket_refresh') {
      handleTicketRefresh(session, parsed);
      return;
    }

    if (parsed.type === 'catchup_request') {
      handleCatchupRequest(session, parsed);
      return;
    }

    if (parsed.type === 'catchup_ack') {
      handleCatchupAck(session, parsed);
      return;
    }

    if (parsed.type === 'push_subscribe') {
      handlePushSubscribe(session, parsed);
      return;
    }

    if (parsed.type === 'push_unsubscribe') {
      handlePushUnsubscribe(session, parsed);
      return;
    }

    forwardEvent(session, parsed);
  };

  ws.on('message', (raw) => {
    try {
      handleMessage(raw);
    } catch (error) {
      log('error', 'relay message handling failed', {
        sessionId: session.id,
        error: error instanceof TypeError ? 'TypeError' : 'Unexpected error',
      });
      ws.close(1011, 'Internal relay error');
    }
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
  pruneExpiredRoomState();
  pruneInvitations();

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
