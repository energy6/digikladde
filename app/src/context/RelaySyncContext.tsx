/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { message } from 'antd';
import { db } from '../db/database';
import type {
  Course,
  CourseSyncSnapshot,
  RelaySyncEnvelope,
  ShareSession,
  ShareSessionState,
  SyncEvent,
  SyncNotification,
  SyncOperationType,
} from '../models/types';
import { createId } from '../utils/idGenerator';
import { ingestRemoteDeltaEvent, listCourseDeltaEvents, listRoomDeltaEvents, logLocalDeltaEvent } from '../utils/syncEvents';
import { exportCourseSnapshot, importCourseSnapshot } from '../utils/syncSnapshot';
import { getExistingPushSubscription, registerPushNotifications } from '../utils/pushNotifications';
import { assertMessageSize, isRecord, MAX_PUSH_BYTES, MAX_SYNC_BYTES, randomSecret, type EncryptedBox } from '../utils/e2eCrypto';
import { getRoomKey, replayId, sealRoomMessage, type RoomKey } from '../utils/roomKeys';
import { applyProtectedSync, openRoomMessage } from '../utils/protectedSync';
import { createInvitation } from '../utils/invitations';

type StartShareSessionInput = {
  courseId: number;
};

type JoinShareSessionInput = {
  courseId: number;
  roomId: string;
  joinSecret: string;
  roomKey: RoomKey;
};

type LogLocalDeltaInput = {
  courseId: number;
  roomId: string;
  operation: SyncOperationType;
  entitySyncId: string;
  payload: unknown;
  notification?: SyncNotification;
};

type LogCourseDeltaInput = {
  courseId: number;
  operation: SyncOperationType;
  entitySyncId: string;
  payload: unknown;
  notification?: SyncNotification;
};

type RelaySyncContextValue = {
  deviceId: string;
  username: string;
  relayBaseUrl: string;
  startShareSession: (input: StartShareSessionInput) => Promise<ShareSession>;
  joinShareSession: (input: JoinShareSessionInput) => Promise<ShareSession>;
  createJoinInvitation: (courseId: number, baseUrl: string) => Promise<string>;
  updateShareSessionState: (courseSyncId: string, state: ShareSessionState) => Promise<void>;
  touchShareSession: (courseSyncId: string) => Promise<void>;
  leaveShareSession: (courseSyncId: string) => Promise<void>;
  getShareSession: (courseSyncId: string) => Promise<ShareSession | undefined>;
  listShareSessions: () => Promise<ShareSession[]>;
  exportSnapshot: (courseId: number) => Promise<CourseSyncSnapshot>;
  importSnapshot: (snapshot: CourseSyncSnapshot) => Promise<{ courseId: number; importedFlights: number; importedStudents: number }>;
  logLocalDelta: (input: LogLocalDeltaInput) => Promise<SyncEvent>;
  logCourseDelta: (input: LogCourseDeltaInput) => Promise<SyncEvent | undefined>;
  ingestRemoteDelta: (envelope: RelaySyncEnvelope) => Promise<{ accepted: boolean; event: SyncEvent }>;
  listCourseDeltas: (courseSyncId: string) => Promise<SyncEvent[]>;
  listRoomDeltas: (roomId: string) => Promise<SyncEvent[]>;
  connectCourseSession: (courseId: number) => Promise<void>;
  disconnectCourseSession: (courseId: number) => Promise<void>;
  sendPendingDeltas: (courseId: number) => Promise<number>;
  subscribeSnapshotImports: (courseId: number, listener: (importedCourseId: number) => void) => () => void;
  subscribeCourseChanges: (courseId: number, listener: () => void) => () => void;
  waitForInitialSnapshot: (courseId: number, timeoutMs?: number) => Promise<number | null>;
};

type RelaySyncProviderProps = {
  children: ReactNode;
  username: string;
  relayBaseUrl: string;
  pushNotificationsEnabled: boolean;
};

const DEVICE_ID_STORAGE_KEY = 'digikladde.deviceId';

type RelayMessage = {
  version: 2;
  type: string;
  roomId?: string;
  deviceId?: string;
  ticket?: string;
  seq?: number;
  targetDeviceId?: string;
  payload?: Record<string, unknown>;
};

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_RECONNECT_DELAY_MS = 30_000;

type ConnectionState = {
  courseId: number;
  courseSyncId: string;
  roomId: string;
  ws: WebSocket;
  ticket?: string;
  seq: number;
  sentOpIds: Set<string>;
  messageQueue: Array<() => Promise<void>>;
  processing: boolean;
  reconnectAttempts: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  ticketRefreshTimer?: ReturnType<typeof setTimeout>;
  joinTimer: ReturnType<typeof setTimeout>;
  intentionalClose: boolean;
  ready: Promise<void>;
  resolveReady: () => void;
  rejectReady: (error: Error) => void;
};

const RelaySyncContext = createContext<RelaySyncContextValue | null>(null);

const normalizeRelayBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

const toRelayWebSocketUrl = (relayBaseUrl: string): string => {
  if (relayBaseUrl.startsWith('https://')) {
    return `${relayBaseUrl.replace(/^https:\/\//, 'wss://')}/relay`;
  }
  return `${relayBaseUrl.replace(/^http:\/\//, 'ws://')}/relay`;
};

const readOrCreateDeviceId = (): string => {
  if (typeof window === 'undefined') return createId('device');

  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;

  const created = createId('device');
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
};

const ensureCourseSyncId = async (courseId: number): Promise<{ course: Course; courseSyncId: string }> => {
  const course = await db.courses.get(courseId);
  if (!course) {
    throw new Error('Kurs nicht gefunden.');
  }

  if (course.syncId) {
    return { course, courseSyncId: course.syncId };
  }

  const courseSyncId = createId('course');
  const now = new Date().toISOString();

  await db.courses.update(courseId, {
    syncId: courseSyncId,
    updatedAt: now,
    updatedByDeviceId: 'local-device',
  });

  return {
    course: {
      ...course,
      syncId: courseSyncId,
      updatedAt: now,
      updatedByDeviceId: 'local-device',
    },
    courseSyncId,
  };
};

export const RelaySyncProvider = ({ children, username, relayBaseUrl, pushNotificationsEnabled }: RelaySyncProviderProps) => {
  const deviceId = useMemo(() => readOrCreateDeviceId(), []);
  const normalizedRelayBaseUrl = useMemo(() => normalizeRelayBaseUrl(relayBaseUrl), [relayBaseUrl]);
  const connectionsRef = useRef<Map<string, ConnectionState>>(new Map());
  const reconnectCourseSessionRef = useRef<(courseIdValue: number) => void>(() => {});
  const snapshotListenersRef = useRef<Map<number, Set<(importedCourseId: number) => void>>>(new Map());
  const courseChangeListenersRef = useRef<Map<number, Set<() => void>>>(new Map());
  const pendingSnapshotWaitersRef = useRef<Map<number, Array<(importedCourseId: number) => void>>>(new Map());
  const latestSnapshotImportRef = useRef<Map<number, number>>(new Map());

  const emitSnapshotImport = useCallback((courseId: number, importedCourseId: number) => {
    latestSnapshotImportRef.current.set(courseId, importedCourseId);

    const listeners = snapshotListenersRef.current.get(courseId);
    if (listeners) {
      listeners.forEach((listener) => listener(importedCourseId));
    }

    const waiters = pendingSnapshotWaitersRef.current.get(courseId);
    if (waiters && waiters.length > 0) {
      waiters.forEach((resolve) => resolve(importedCourseId));
      pendingSnapshotWaitersRef.current.delete(courseId);
    }
  }, []);

  const subscribeSnapshotImports = useCallback((courseId: number, listener: (importedCourseId: number) => void) => {
    const existing = snapshotListenersRef.current.get(courseId) ?? new Set<(importedCourseId: number) => void>();
    existing.add(listener);
    snapshotListenersRef.current.set(courseId, existing);

    return () => {
      const current = snapshotListenersRef.current.get(courseId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        snapshotListenersRef.current.delete(courseId);
      }
    };
  }, []);

  const emitCourseChange = useCallback((courseId: number) => {
    const listeners = courseChangeListenersRef.current.get(courseId);
    if (!listeners) return;
    listeners.forEach((listener) => listener());
  }, []);

  const subscribeCourseChanges = useCallback((courseId: number, listener: () => void) => {
    const existing = courseChangeListenersRef.current.get(courseId) ?? new Set<() => void>();
    existing.add(listener);
    courseChangeListenersRef.current.set(courseId, existing);

    return () => {
      const current = courseChangeListenersRef.current.get(courseId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        courseChangeListenersRef.current.delete(courseId);
      }
    };
  }, []);

  const waitForInitialSnapshot = useCallback(async (courseId: number, timeoutMs = 10000): Promise<number | null> => {
    const latest = latestSnapshotImportRef.current.get(courseId);
    if (latest) return latest;

    return new Promise<number | null>((resolve) => {
      const waiters = pendingSnapshotWaitersRef.current.get(courseId) ?? [];
      const resolveOnce = (importedCourseId: number) => {
        window.clearTimeout(timeoutHandle);
        resolve(importedCourseId);
      };

      waiters.push(resolveOnce);
      pendingSnapshotWaitersRef.current.set(courseId, waiters);

      const timeoutHandle = window.setTimeout(() => {
        const currentWaiters = pendingSnapshotWaitersRef.current.get(courseId) ?? [];
        pendingSnapshotWaitersRef.current.set(courseId, currentWaiters.filter((candidate) => candidate !== resolveOnce));
        resolve(null);
      }, timeoutMs);
    });
  }, []);

  const persistSession = useCallback(async (session: Omit<ShareSession, 'id'>): Promise<ShareSession> => {
    const existing = await db.shareSessions.where('courseSyncId').equals(session.courseSyncId).first();

    if (existing?.id) {
      await db.shareSessions.update(existing.id, session);
      return { ...existing, ...session };
    }

    const id = Number(await db.shareSessions.add(session));
    return { ...session, id };
  }, []);

  const startShareSession = useCallback(async ({ courseId }: StartShareSessionInput): Promise<ShareSession> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const existing = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    const roomId = existing?.roomId ?? randomSecret();
    if (!existing) {
      await db.roomKeys.add({ roomId, courseSyncId, secret: randomSecret(), epoch: randomSecret(), sentCount: 0 });
    } else {
      await getRoomKey(roomId);
    }

    const now = new Date().toISOString();

    return persistSession({
      courseSyncId,
      roomId,
      joinSecret: existing?.joinSecret ?? randomSecret(),
      relayBaseUrl: normalizedRelayBaseUrl,
      deviceId,
      username,
      state: existing?.state ?? 'idle',
      lastSyncedAt: existing?.lastSyncedAt,
      updatedAt: now,
    });
  }, [deviceId, normalizedRelayBaseUrl, persistSession, username]);

  const joinShareSession = useCallback(async ({ courseId, roomId, joinSecret, roomKey }: JoinShareSessionInput): Promise<ShareSession> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    latestSnapshotImportRef.current.delete(courseId);
    if (roomKey.roomId !== roomId || roomKey.courseSyncId !== courseSyncId) throw new Error('Einladung gehört nicht zum Kurs.');
    const localKey = await db.roomKeys.get(roomId);
    await db.roomKeys.put(localKey?.secret === roomKey.secret && localKey.epoch === roomKey.epoch ? localKey : roomKey);
    const now = new Date().toISOString();

    return persistSession({
      courseSyncId,
      roomId: roomId.trim(),
      joinSecret: joinSecret.trim(),
      relayBaseUrl: normalizedRelayBaseUrl,
      deviceId,
      username,
      state: 'idle',
      updatedAt: now,
    });
  }, [deviceId, normalizedRelayBaseUrl, persistSession, username]);

  const updateShareSessionState = useCallback(async (courseSyncId: string, state: ShareSessionState): Promise<void> => {
    const existing = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    if (!existing?.id) return;

    await db.shareSessions.update(existing.id, {
      state,
      updatedAt: new Date().toISOString(),
    });
  }, []);

  const touchShareSession = useCallback(async (courseSyncId: string): Promise<void> => {
    const existing = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    if (!existing?.id) return;

    const now = new Date().toISOString();
    await db.shareSessions.update(existing.id, {
      lastSyncedAt: now,
      updatedAt: now,
    });
  }, []);

  const sendPushUnsubscribeOverConnection = useCallback((connection: ConnectionState): void => {
    if (connection.ws.readyState !== WebSocket.OPEN || !connection.ticket) return;
    connection.ws.send(JSON.stringify({
      version: 2, type: 'push_unsubscribe', roomId: connection.roomId, deviceId,
      ticket: connection.ticket, seq: connection.seq++,
    }));
  }, [deviceId]);

  const closeCourseConnection = useCallback((connection: ConnectionState): void => {
    connection.intentionalClose = true;
    clearTimeout(connection.joinTimer);
    clearTimeout(connection.reconnectTimer);
    clearTimeout(connection.ticketRefreshTimer);
    connection.messageQueue.length = 0;
    connection.rejectReady(new DOMException('Raumverbindung bewusst beendet.', 'AbortError'));
    if (connectionsRef.current.get(connection.courseSyncId) === connection) {
      connectionsRef.current.delete(connection.courseSyncId);
    }
    if (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING) {
      connection.ws.close(1000, 'session_disconnect');
    }
  }, []);

  const leaveShareSession = useCallback(async (courseSyncId: string): Promise<void> => {
    const existing = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    if (!existing?.id) return;
    const connection = connectionsRef.current.get(courseSyncId);
    if (connection) {
      sendPushUnsubscribeOverConnection(connection);
      closeCourseConnection(connection);
    }
    await db.transaction('rw', db.shareSessions, db.roomKeys, db.receivedMessages, async () => {
      await db.shareSessions.delete(existing.id);
      await db.roomKeys.delete(existing.roomId);
      await db.receivedMessages.where('roomId').equals(existing.roomId).delete();
    });
  }, [closeCourseConnection, sendPushUnsubscribeOverConnection]);

  const getShareSession = useCallback(async (courseSyncId: string): Promise<ShareSession | undefined> => {
    return db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
  }, []);

  const listShareSessions = useCallback(async (): Promise<ShareSession[]> => {
    return db.shareSessions.orderBy('updatedAt').reverse().toArray();
  }, []);

  const exportSnapshot = useCallback(async (courseId: number): Promise<CourseSyncSnapshot> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const session = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    return exportCourseSnapshot(courseId, session?.roomId, deviceId);
  }, [deviceId]);

  const importSnapshot = useCallback(async (snapshot: CourseSyncSnapshot) => {
    return importCourseSnapshot(snapshot, deviceId);
  }, [deviceId]);

  const logLocalDelta = useCallback(async (input: LogLocalDeltaInput): Promise<SyncEvent> => {
    return logLocalDeltaEvent({
      ...input,
      deviceId,
    });
  }, [deviceId]);

  const sendDeltaEventsOverConnection = useCallback(async (connection: ConnectionState): Promise<number> => {
    if (connection.ws.readyState !== WebSocket.OPEN || !connection.ticket) return 0;

    const events = (await listCourseDeltaEvents(connection.courseSyncId))
      .filter((event) => event.roomId === connection.roomId && event.deviceId === deviceId && !event.sentToRelayAt);
    let sentCount = 0;

    for (const event of events) {
      if (connection.sentOpIds.has(event.opId)) continue;

      const relayEnvelope: RelaySyncEnvelope = {
        version: 1,
        schemaVersion: 1,
        roomId: event.roomId,
        courseSyncId: event.courseSyncId,
        deviceId: event.deviceId,
        opId: event.opId,
        opTs: event.opTs,
        operation: event.operation,
        payload: event.payload,
        notification: event.notification,
      };

      const box = await sealRoomMessage(connection.roomId, deviceId, 'delta', relayEnvelope, event.opId);
      let push: EncryptedBox | undefined;
      if (event.notification) {
        push = await sealRoomMessage(connection.roomId, deviceId, 'push', event.notification, event.opId);
        if (new TextEncoder().encode(JSON.stringify(push)).byteLength > MAX_PUSH_BYTES) {
          push = undefined;
          message.warning('Push-Details sind zu groß. Es wird nur ein allgemeiner Hinweis gesendet.');
        }
      }
      const outbound: RelayMessage = {
        version: 2,
        type: 'sync_response',
        roomId: connection.roomId,
        deviceId,
        ticket: connection.ticket,
        seq: connection.seq++,
        payload: { box, ...(push ? { push } : {}) },
      };
      assertMessageSize(outbound, MAX_SYNC_BYTES);
      connection.ws.send(JSON.stringify(outbound));
      connection.sentOpIds.add(event.opId);
      if (event.id) {
        await db.syncEvents.update(event.id, { sentToRelayAt: new Date().toISOString() });
      }
      sentCount += 1;
    }

    if (sentCount > 0) {
      await touchShareSession(connection.courseSyncId);
    }

    return sentCount;
  }, [deviceId, touchShareSession]);

  const logCourseDelta = useCallback(async (input: LogCourseDeltaInput): Promise<SyncEvent | undefined> => {
    const { courseSyncId } = await ensureCourseSyncId(input.courseId);
    const session = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    if (!session?.roomId) return undefined;

    const event = await logLocalDeltaEvent({
      courseId: input.courseId,
      roomId: session.roomId,
      operation: input.operation,
      entitySyncId: input.entitySyncId,
      payload: input.payload,
      notification: input.notification,
      deviceId,
    });

    const connection = connectionsRef.current.get(courseSyncId);
    if (connection) {
      void sendDeltaEventsOverConnection(connection).catch(() => {
        void updateShareSessionState(courseSyncId, 'error');
        message.error('Verschlüsselte Änderungen konnten nicht gesendet werden.');
      });
    }

    return event;
  }, [deviceId, sendDeltaEventsOverConnection, updateShareSessionState]);

  const ingestRemoteDelta = useCallback(async (envelope: RelaySyncEnvelope) => {
    return ingestRemoteDeltaEvent(envelope);
  }, []);

  const listCourseDeltas = useCallback(async (courseSyncId: string): Promise<SyncEvent[]> => {
    return listCourseDeltaEvents(courseSyncId);
  }, []);

  const listRoomDeltas = useCallback(async (roomId: string): Promise<SyncEvent[]> => {
    return listRoomDeltaEvents(roomId);
  }, []);

  const sendPendingDeltas = useCallback(async (courseId: number): Promise<number> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const connection = connectionsRef.current.get(courseSyncId);
    if (!connection) return 0;
    return sendDeltaEventsOverConnection(connection);
  }, [sendDeltaEventsOverConnection]);

  const sendPushSubscriptionOverConnection = useCallback(async (connection: ConnectionState, subscription: PushSubscription): Promise<void> => {
    if (connection.ws.readyState !== WebSocket.OPEN || !connection.ticket) return;

    const message: RelayMessage = {
      version: 2,
      type: 'push_subscribe',
      roomId: connection.roomId,
      deviceId,
      ticket: connection.ticket,
      seq: connection.seq++,
      payload: {
        subscription: subscription.toJSON(),
      },
    };

    connection.ws.send(JSON.stringify(message));

    const existing = await db.shareSessions.where('courseSyncId').equals(connection.courseSyncId).first();
    if (existing?.id) {
      await db.shareSessions.update(existing.id, {
        pushSubscribedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  }, [deviceId]);

  const registerPushForConnection = useCallback(async (connection: ConnectionState): Promise<void> => {
    if (!pushNotificationsEnabled) return;

    const existing = await getExistingPushSubscription();
    if (existing) {
      await sendPushSubscriptionOverConnection(connection, existing);
      return;
    }

    const session = await db.shareSessions.where('courseSyncId').equals(connection.courseSyncId).first();
    const result = await registerPushNotifications(session?.relayBaseUrl || normalizedRelayBaseUrl, {
      requestPermission: false,
    });

    if (result.status === 'subscribed') {
      await sendPushSubscriptionOverConnection(connection, result.subscription);
    }
  }, [normalizedRelayBaseUrl, pushNotificationsEnabled, sendPushSubscriptionOverConnection]);

  const disconnectCourseSession = useCallback(async (courseId: number): Promise<void> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const connection = connectionsRef.current.get(courseSyncId);
    if (!connection) return;
    closeCourseConnection(connection);
    await updateShareSessionState(connection.courseSyncId, 'idle');
  }, [closeCourseConnection, updateShareSessionState]);

  const connectCourseSession = useCallback(async (courseId: number): Promise<void> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const session = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();

    if (!session) {
      throw new Error('Keine Share-Session für diesen Kurs vorhanden.');
    }
    await getRoomKey(session.roomId);

    const existingConnection = connectionsRef.current.get(courseSyncId);
    if (existingConnection && (existingConnection.ws.readyState === WebSocket.OPEN || existingConnection.ws.readyState === WebSocket.CONNECTING)) {
      return existingConnection.ready;
    }
    if (existingConnection) closeCourseConnection(existingConnection);

    const wsUrl = toRelayWebSocketUrl(session.relayBaseUrl || normalizedRelayBaseUrl);
    const ws = new WebSocket(wsUrl);

    let resolveReady: () => void = () => {};
    let rejectReady: (error: Error) => void = () => {};
    const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    const joinTimeout = setTimeout(() => {
      rejectReady(new Error('Zeitüberschreitung beim sicheren Raumbeitritt.'));
      ws.close(1000, 'join_timeout');
    }, 15000);
    const connection: ConnectionState = {
      courseId,
      courseSyncId,
      roomId: session.roomId,
      ws,
      seq: 1,
      sentOpIds: new Set<string>(),
      messageQueue: [],
      processing: false,
      reconnectAttempts: existingConnection?.reconnectAttempts ?? 0,
      intentionalClose: false,
      ready, resolveReady, rejectReady, joinTimer: joinTimeout,
    };

    connectionsRef.current.set(courseSyncId, connection);
    const isCurrent = () => connectionsRef.current.get(courseSyncId) === connection && !connection.intentionalClose;
    const connectingState = updateShareSessionState(courseSyncId, 'connecting');

    const processQueue = async () => {
      if (connection.processing) return;
      connection.processing = true;

      while (isCurrent() && connection.messageQueue.length > 0) {
        const task = connection.messageQueue.shift();
        if (task) {
          try {
            await task();
          } catch {
            if (!isCurrent()) break;
            closeCourseConnection(connection);
            await updateShareSessionState(connection.courseSyncId, 'error');
            message.error('Sync-Nachricht konnte nicht sicher verarbeitet werden. Bitte erneut synchronisieren.');
          }
        }
      }

      connection.processing = false;
    };

    const enqueue = (task: () => Promise<void>) => {
      connection.messageQueue.push(task);
      void processQueue();
    };

    const handleWsOpen = () => {
      if (!isCurrent()) return;

      const joinMessage: RelayMessage = {
        version: 2,
        type: 'join_request',
        roomId: session.roomId,
        deviceId,
        seq: connection.seq++,
        payload: {
          roomId: session.roomId,
          deviceId,
          joinSecret: session.joinSecret,
        },
      };

      ws.send(JSON.stringify(joinMessage));
    };

    const scheduleTicketRefresh = (incoming: RelayMessage) => {
      if (connection.ticketRefreshTimer) clearTimeout(connection.ticketRefreshTimer);
      const expiresAt = incoming.payload?.ticketExpiresAt;
      const serverTime = incoming.payload?.serverTime;
      if (typeof expiresAt !== 'number' || typeof serverTime !== 'number' || expiresAt <= serverTime) {
        enqueue(() => Promise.reject(new Error('Ungültige Ticket-Laufzeit.')));
        return false;
      }
      connection.ticketRefreshTimer = setTimeout(() => {
        if (!isCurrent() || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          version: 2, type: 'ticket_refresh', roomId: session.roomId, deviceId,
          ticket: connection.ticket, seq: connection.seq++,
        }));
      }, Math.max(1000, (expiresAt - serverTime) / 2));
      return true;
    };

    const handleJoinOk = (incoming: RelayMessage) => {
      if (typeof incoming.ticket !== 'string' || incoming.roomId !== session.roomId || incoming.deviceId !== deviceId) {
        enqueue(() => Promise.reject(new Error('Ungültige Beitrittsbestätigung.')));
        return;
      }
      clearTimeout(joinTimeout);
      connection.reconnectAttempts = 0;
      connection.ticket = incoming.ticket;
      if (!scheduleTicketRefresh(incoming)) return;
      connection.resolveReady();
      void updateShareSessionState(courseSyncId, 'connected');

      const catchupRequest: RelayMessage = {
        version: 2,
        type: 'catchup_request',
        roomId: session.roomId,
        deviceId,
        ticket: connection.ticket,
        seq: connection.seq++,
        payload: {
          afterSeq: 0,
        },
      };

      ws.send(JSON.stringify(catchupRequest));
      enqueue(async () => {
        const syncRequest: RelayMessage = {
          version: 2, type: 'sync_request', roomId: session.roomId, deviceId,
          ticket: connection.ticket, seq: connection.seq++,
          payload: { box: await sealRoomMessage(session.roomId, deviceId, 'snapshot_request', { mode: 'snapshot_request' }) },
        };
        ws.send(JSON.stringify(syncRequest));
        await sendDeltaEventsOverConnection(connection);
        await registerPushForConnection(connection);
      });
    };

    const handleSyncRequest = (incoming: RelayMessage) => {
      enqueue(async () => {
        if (!connection.ticket || !incoming.deviceId) throw new Error('Nicht autorisierte Sync-Anfrage.');
        const { box, value } = await openRoomMessage(session.roomId, incoming.payload?.box, 'snapshot_request', incoming.deviceId);
        if (!isRecord(value) || value.mode !== 'snapshot_request') throw new Error('Ungültige Snapshot-Anfrage.');
        const id = replayId(box);
        const fresh = await db.transaction('rw', db.receivedMessages, async () => {
          if (await db.receivedMessages.get(id)) return false;
          await db.receivedMessages.add({ id, roomId: session.roomId });
          return true;
        });
        if (!fresh) return;
        const snapshot = await exportCourseSnapshot(courseId, session.roomId, deviceId);
        const response: RelayMessage = {
          version: 2,
          type: 'sync_response',
          roomId: session.roomId,
          deviceId,
          ticket: connection.ticket,
          seq: connection.seq++,
          targetDeviceId: incoming.deviceId,
          payload: { box: await sealRoomMessage(session.roomId, deviceId, 'snapshot', snapshot) },
        };
        assertMessageSize(response, MAX_SYNC_BYTES);
        ws.send(JSON.stringify(response));
        await touchShareSession(connection.courseSyncId);
      });
    };

    const handleSyncResponse = (incoming: RelayMessage) => {
      enqueue(async () => {
        if (!incoming.deviceId) throw new Error('Absender fehlt.');
        const imported = await applyProtectedSync(session.roomId, incoming.payload?.box, deviceId, incoming.deviceId);
        await touchShareSession(connection.courseSyncId);
        if (imported.snapshot) emitSnapshotImport(connection.courseId, imported.courseId);
        emitCourseChange(imported.courseId);
      });
    };

    const handleCatchupResponse = (incoming: RelayMessage) => {
      const messages = incoming.payload?.messages;
      enqueue(async () => {
        if (!Array.isArray(messages) || !connection.ticket) throw new Error('Ungültige Catch-up-Antwort.');
        // Relay queues restart at one after a restart; persistent message IDs provide replay protection.
        let highestAppliedSeq = 0;
        for (const queuedMessage of messages) {
          if (!isRecord(queuedMessage) || !Number.isSafeInteger(queuedMessage.seq)
            || typeof queuedMessage.seq !== 'number' || queuedMessage.seq <= highestAppliedSeq
            || queuedMessage.type !== 'sync_response' || !isRecord(queuedMessage.payload)
            || typeof queuedMessage.fromDeviceId !== 'string') throw new Error('Ungültige Catch-up-Nachricht.');
          const result = await applyProtectedSync(session.roomId, queuedMessage.payload.box, deviceId, queuedMessage.fromDeviceId);
          emitCourseChange(result.courseId);
          highestAppliedSeq = queuedMessage.seq;
        }
        if (highestAppliedSeq === 0) return;
        const ackMessage: RelayMessage = {
          version: 2,
          type: 'catchup_ack',
          roomId: connection.roomId,
          deviceId,
          ticket: connection.ticket,
          seq: connection.seq++,
          payload: {
            throughSeq: highestAppliedSeq,
          },
        };

        ws.send(JSON.stringify(ackMessage));
        await touchShareSession(connection.courseSyncId);
      });
    };

    const handleWsMessage = (event: MessageEvent) => {
      if (!isCurrent()) return;
      let incoming: RelayMessage;

      try {
        incoming = JSON.parse(String(event.data)) as RelayMessage;
      } catch {
        enqueue(() => Promise.reject(new Error('Ungültige Relay-Nachricht.')));
        return;
      }
      if (!isRecord(incoming) || incoming.version !== 2) {
        enqueue(() => Promise.reject(new Error('Veraltetes Relay-Protokoll.')));
        return;
      }

      if (incoming.type === 'ticket_refresh' && incoming.ticket) {
        connection.ticket = incoming.ticket;
        scheduleTicketRefresh(incoming);
        return;
      }

      if (incoming.type === 'join_ok') { handleJoinOk(incoming); return; }
      if (incoming.type === 'join_denied' || incoming.type === 'error') {
        connection.rejectReady(new Error('Sicherer Raumbeitritt oder Relay-Anfrage abgelehnt.'));
        closeCourseConnection(connection);
        void updateShareSessionState(courseSyncId, 'error');
        console.warn('Sync: Relay-Anfrage abgelehnt.');
        return;
      }
      if (incoming.type === 'catchup_response') { handleCatchupResponse(incoming); return; }
      if (incoming.type === 'sync_request') { handleSyncRequest(incoming); return; }

      if (incoming.type === 'sync_response') handleSyncResponse(incoming);
    };

    const handleWsClose = () => {
      clearTimeout(joinTimeout);
      if (connection.ticketRefreshTimer) clearTimeout(connection.ticketRefreshTimer);
      if (!isCurrent()) {
        connection.rejectReady(new DOMException('Veraltete Raumverbindung beendet.', 'AbortError'));
        return;
      }
      connection.rejectReady(new Error('Verbindung zum Relay beendet.'));
      void updateShareSessionState(connection.courseSyncId, 'error');

      const canRetryInForeground = typeof document === 'undefined' || !document.hidden;

      if (canRetryInForeground && connection.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, connection.reconnectAttempts), MAX_RECONNECT_DELAY_MS);
        connection.reconnectAttempts += 1;
        connection.reconnectTimer = setTimeout(() => {
          if (isCurrent()) reconnectCourseSessionRef.current(courseId);
        }, delay);
      }
    };

    const handleWsError = () => {
      if (isCurrent()) void updateShareSessionState(courseSyncId, 'error');
    };

    ws.onopen = handleWsOpen;
    ws.onmessage = handleWsMessage;
    ws.onclose = handleWsClose;
    ws.onerror = handleWsError;
    await connectingState;
    await ready;
  }, [
    closeCourseConnection,
    emitCourseChange,
    emitSnapshotImport,
    deviceId,
    normalizedRelayBaseUrl,
    registerPushForConnection,
    sendDeltaEventsOverConnection,
    touchShareSession,
    updateShareSessionState,
  ]);

  const createJoinInvitation = useCallback(async (courseId: number, baseUrl: string): Promise<string> => {
    await connectCourseSession(courseId);
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const session = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    const connection = connectionsRef.current.get(courseSyncId);
    if (!session || !connection?.ticket) throw new Error('Keine autorisierte Verbindung zum Relay.');
    return createInvitation(session, connection.ticket, baseUrl);
  }, [connectCourseSession]);

  const reconnectCourseSession = useCallback((courseId: number): void => {
    void connectCourseSession(courseId).catch(async (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('Sync: Automatische Verbindung fehlgeschlagen.');
      const course = await db.courses.get(courseId);
      if (!course?.syncId) return;
      const current = connectionsRef.current.get(course.syncId);
      if (!current || current.ws.readyState === WebSocket.CLOSED) {
        await updateShareSessionState(course.syncId, 'error');
      }
    }).catch(() => console.warn('Sync: Verbindungsfehler konnte nicht gespeichert werden.'));
  }, [connectCourseSession, updateShareSessionState]);

  useEffect(() => {
    for (const connection of connectionsRef.current.values()) {
      if (pushNotificationsEnabled) {
        void registerPushForConnection(connection);
      } else {
        sendPushUnsubscribeOverConnection(connection);
      }
    }
  }, [pushNotificationsEnabled, registerPushForConnection, sendPushUnsubscribeOverConnection]);

  useEffect(() => {
    reconnectCourseSessionRef.current = reconnectCourseSession;
  }, [reconnectCourseSession]);

  useEffect(() => {
    const reconnectSharedSessions = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (typeof document !== 'undefined' && document.hidden) return;

      const sessions = await db.shareSessions.toArray();
      for (const session of sessions) {
        const course = await db.courses.where('syncId').equals(session.courseSyncId).first();
        if (!course?.id) continue;

        const connection = connectionsRef.current.get(session.courseSyncId);
        const isOpen = connection && (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING);
        if (isOpen) continue;

        reconnectCourseSession(course.id);
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void reconnectSharedSessions().catch(reportReconnectError);
      }
    };

    const handleOnline = () => {
      void reconnectSharedSessions().catch(reportReconnectError);
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    const reportReconnectError = () => console.warn('Sync: Freigaben konnten nicht für die Wiederverbindung geladen werden.');
    void reconnectSharedSessions().catch(reportReconnectError);

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
    };
  }, [reconnectCourseSession]);

  const contextValue = useMemo<RelaySyncContextValue>(() => ({
    deviceId,
    username,
    relayBaseUrl: normalizedRelayBaseUrl,
    startShareSession,
    joinShareSession,
    createJoinInvitation,
    updateShareSessionState,
    touchShareSession,
    leaveShareSession,
    getShareSession,
    listShareSessions,
    exportSnapshot,
    importSnapshot,
    logLocalDelta,
    logCourseDelta,
    ingestRemoteDelta,
    listCourseDeltas,
    listRoomDeltas,
    connectCourseSession,
    disconnectCourseSession,
    sendPendingDeltas,
    subscribeSnapshotImports,
    subscribeCourseChanges,
    waitForInitialSnapshot,
  }), [
    connectCourseSession,
    createJoinInvitation,
    deviceId,
    disconnectCourseSession,
    exportSnapshot,
    getShareSession,
    ingestRemoteDelta,
    importSnapshot,
    joinShareSession,
    listCourseDeltas,
    listRoomDeltas,
    leaveShareSession,
    listShareSessions,
    logCourseDelta,
    logLocalDelta,
    normalizedRelayBaseUrl,
    startShareSession,
    subscribeCourseChanges,
    subscribeSnapshotImports,
    touchShareSession,
    updateShareSessionState,
    waitForInitialSnapshot,
    username,
    sendPendingDeltas,
  ]);

  return (
    <RelaySyncContext.Provider value={contextValue}>
      {children}
    </RelaySyncContext.Provider>
  );
};

export const useRelaySync = (): RelaySyncContextValue => {
  const value = useContext(RelaySyncContext);
  if (!value) {
    throw new Error('useRelaySync muss innerhalb des RelaySyncProvider verwendet werden.');
  }
  return value;
};
