/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { db } from '../db/database';
import type {
  Course,
  CourseSyncSnapshot,
  RelaySyncEnvelope,
  ShareSession,
  ShareSessionState,
  SyncEvent,
  SyncOperationType,
} from '../models/types';
import { createId, createJoinSecret } from '../utils/idGenerator';
import { applyRemoteDeltaEnvelope } from '../utils/syncApply';
import { ingestRemoteDeltaEvent, listCourseDeltaEvents, listRoomDeltaEvents, logLocalDeltaEvent } from '../utils/syncEvents';
import { exportCourseSnapshot, importCourseSnapshot } from '../utils/syncSnapshot';
import { isCourseSyncSnapshot, isRelaySyncEnvelope } from '../utils/typeGuards';

type StartShareSessionInput = {
  courseId: number;
};

type JoinShareSessionInput = {
  courseId: number;
  roomId: string;
  joinSecret: string;
};

type LogLocalDeltaInput = {
  courseId: number;
  roomId: string;
  operation: SyncOperationType;
  entitySyncId: string;
  payload: unknown;
};

type LogCourseDeltaInput = {
  courseId: number;
  operation: SyncOperationType;
  entitySyncId: string;
  payload: unknown;
};

type RelaySyncContextValue = {
  deviceId: string;
  username: string;
  relayBaseUrl: string;
  startShareSession: (input: StartShareSessionInput) => Promise<ShareSession>;
  joinShareSession: (input: JoinShareSessionInput) => Promise<ShareSession>;
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
};

const DEVICE_ID_STORAGE_KEY = 'digikladde.deviceId';

type RelayMessage = {
  version: 1;
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
  intentionalClose: boolean;
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

export const RelaySyncProvider = ({ children, username, relayBaseUrl }: RelaySyncProviderProps) => {
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

    const now = new Date().toISOString();

    return persistSession({
      courseSyncId,
      roomId: existing?.roomId ?? createId('room'),
      joinSecret: existing?.joinSecret ?? createJoinSecret(),
      relayBaseUrl: normalizedRelayBaseUrl,
      deviceId,
      username,
      state: existing?.state ?? 'idle',
      lastSyncedAt: existing?.lastSyncedAt,
      updatedAt: now,
    });
  }, [deviceId, normalizedRelayBaseUrl, persistSession, username]);

  const joinShareSession = useCallback(async ({ courseId, roomId, joinSecret }: JoinShareSessionInput): Promise<ShareSession> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
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

  const leaveShareSession = useCallback(async (courseSyncId: string): Promise<void> => {
    const existing = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();
    if (!existing?.id) return;
    await db.shareSessions.delete(existing.id);
  }, []);

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

    const events = await listCourseDeltaEvents(connection.courseSyncId);
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
      };

      const message: RelayMessage = {
        version: 1,
        type: 'sync_response',
        roomId: connection.roomId,
        deviceId,
        ticket: connection.ticket,
        seq: connection.seq++,
        payload: {
          kind: 'delta',
          envelope: relayEnvelope,
        },
      };

      connection.ws.send(JSON.stringify(message));
      connection.sentOpIds.add(event.opId);
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
      deviceId,
    });

    const connection = connectionsRef.current.get(courseSyncId);
    if (connection) {
      void sendDeltaEventsOverConnection(connection);
    }

    return event;
  }, [deviceId, sendDeltaEventsOverConnection]);

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

  const disconnectCourseSession = useCallback(async (courseId: number): Promise<void> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    let connection = connectionsRef.current.get(courseSyncId);

    // Fallback: find connection by courseId if syncId changed after snapshot import
    if (!connection) {
      for (const conn of connectionsRef.current.values()) {
        if (conn.courseId === courseId) {
          connection = conn;
          break;
        }
      }
    }

    if (!connection) return;

    connection.intentionalClose = true;
    if (connection.reconnectTimer) {
      clearTimeout(connection.reconnectTimer);
      connection.reconnectTimer = undefined;
    }

    connectionsRef.current.delete(connection.courseSyncId);
    if (connection.ws.readyState === WebSocket.OPEN || connection.ws.readyState === WebSocket.CONNECTING) {
      connection.ws.close(1000, 'session_disconnect');
    }

    await updateShareSessionState(connection.courseSyncId, 'idle');
  }, [updateShareSessionState]);

  const connectCourseSession = useCallback(async (courseId: number): Promise<void> => {
    const { courseSyncId } = await ensureCourseSyncId(courseId);
    const session = await db.shareSessions.where('courseSyncId').equals(courseSyncId).first();

    if (!session) {
      throw new Error('Keine Share-Session für diesen Kurs vorhanden.');
    }

    const existingConnection = connectionsRef.current.get(courseSyncId);
    if (existingConnection && (existingConnection.ws.readyState === WebSocket.OPEN || existingConnection.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    await updateShareSessionState(courseSyncId, 'connecting');

    const wsUrl = toRelayWebSocketUrl(session.relayBaseUrl || normalizedRelayBaseUrl);
    const ws = new WebSocket(wsUrl);

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
    };

    connectionsRef.current.set(courseSyncId, connection);

    const processQueue = async () => {
      if (connection.processing) return;
      connection.processing = true;

      while (connection.messageQueue.length > 0) {
        const task = connection.messageQueue.shift();
        if (task) {
          try {
            await task();
          } catch {
            // Swallow errors in queued message handlers to avoid blocking the queue.
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
      connection.reconnectAttempts = 0;

      const joinMessage: RelayMessage = {
        version: 1,
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

    const handleJoinOk = (incoming: RelayMessage) => {
      connection.ticket = incoming.ticket;
      void updateShareSessionState(courseSyncId, 'connected');

      const syncRequest: RelayMessage = {
        version: 1,
        type: 'sync_request',
        roomId: session.roomId,
        deviceId,
        ticket: connection.ticket,
        seq: connection.seq++,
        payload: {
          mode: 'snapshot_request',
          courseSyncId,
        },
      };

      ws.send(JSON.stringify(syncRequest));
      void sendDeltaEventsOverConnection(connection);
    };

    const handleSyncRequest = (incoming: RelayMessage) => {
      const mode = typeof incoming.payload?.mode === 'string' ? incoming.payload.mode : '';
      if (mode !== 'snapshot_request' || !connection.ticket) return;

      enqueue(async () => {
        const snapshot = await exportCourseSnapshot(courseId, session.roomId, deviceId);
        const response: RelayMessage = {
          version: 1,
          type: 'sync_response',
          roomId: session.roomId,
          deviceId,
          ticket: connection.ticket,
          seq: connection.seq++,
          targetDeviceId: incoming.deviceId,
          payload: {
            kind: 'snapshot',
            snapshot,
          },
        };
        ws.send(JSON.stringify(response));
        await touchShareSession(connection.courseSyncId);
      });
    };

    const handleSnapshotResponse = (incoming: RelayMessage) => {
      const snapshot = incoming.payload?.snapshot;
      if (!isCourseSyncSnapshot(snapshot)) return;

      enqueue(async () => {
        const imported = await importCourseSnapshot(snapshot, deviceId);
        const importedCourse = await db.courses.get(imported.courseId);
        const importedCourseSyncId = importedCourse?.syncId;

        if (importedCourseSyncId && importedCourseSyncId !== connection.courseSyncId) {
          const existingSession = await db.shareSessions.where('courseSyncId').equals(connection.courseSyncId).first();
          if (existingSession?.id) {
            await db.shareSessions.update(existingSession.id, {
              courseSyncId: importedCourseSyncId,
              updatedAt: new Date().toISOString(),
            });
          }

          connectionsRef.current.delete(connection.courseSyncId);
          connection.courseSyncId = importedCourseSyncId;
          connectionsRef.current.set(importedCourseSyncId, connection);
        }

        await touchShareSession(connection.courseSyncId);
        emitSnapshotImport(connection.courseId, imported.courseId);
        emitCourseChange(imported.courseId);
      });
    };

    const handleDeltaResponse = (incoming: RelayMessage) => {
      const envelope = incoming.payload?.envelope;
      if (!isRelaySyncEnvelope(envelope)) return;

      enqueue(async () => {
        const result = await ingestRemoteDeltaEvent(envelope);
        if (result.accepted) {
          await applyRemoteDeltaEnvelope(envelope);
          await touchShareSession(connection.courseSyncId);

          const localCourse = await db.courses.where('syncId').equals(envelope.courseSyncId).first();
          if (localCourse?.id) {
            emitCourseChange(localCourse.id);
          }
        }
      });
    };

    const handleWsMessage = (event: MessageEvent) => {
      let incoming: RelayMessage;

      try {
        incoming = JSON.parse(String(event.data)) as RelayMessage;
      } catch {
        return;
      }

      if (incoming.type === 'ticket_refresh' && incoming.ticket) {
        connection.ticket = incoming.ticket;
        return;
      }

      if (incoming.type === 'join_ok') { handleJoinOk(incoming); return; }
      if (incoming.type === 'join_denied' || incoming.type === 'error') { void updateShareSessionState(courseSyncId, 'error'); return; }
      if (incoming.type === 'sync_request') { handleSyncRequest(incoming); return; }

      if (incoming.type === 'sync_response') {
        const kind = typeof incoming.payload?.kind === 'string' ? incoming.payload.kind : '';
        if (kind === 'snapshot') { handleSnapshotResponse(incoming); return; }
        if (kind === 'delta') { handleDeltaResponse(incoming); }
      }
    };

    const handleWsClose = () => {
      connectionsRef.current.delete(connection.courseSyncId);
      void updateShareSessionState(connection.courseSyncId, 'idle');

      if (!connection.intentionalClose && connection.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = Math.min(1000 * Math.pow(2, connection.reconnectAttempts), MAX_RECONNECT_DELAY_MS);
        connection.reconnectAttempts += 1;
        connection.reconnectTimer = setTimeout(() => {
          reconnectCourseSessionRef.current(courseId);
        }, delay);
      }
    };

    const handleWsError = () => {
      void updateShareSessionState(courseSyncId, 'error');
    };

    ws.onopen = handleWsOpen;
    ws.onmessage = handleWsMessage;
    ws.onclose = handleWsClose;
    ws.onerror = handleWsError;
  }, [
    emitCourseChange,
    emitSnapshotImport,
    deviceId,
    normalizedRelayBaseUrl,
    sendDeltaEventsOverConnection,
    touchShareSession,
    updateShareSessionState,
  ]);

  useEffect(() => {
    reconnectCourseSessionRef.current = (courseIdValue: number) => {
      void connectCourseSession(courseIdValue);
    };
  }, [connectCourseSession]);

  const contextValue = useMemo<RelaySyncContextValue>(() => ({
    deviceId,
    username,
    relayBaseUrl: normalizedRelayBaseUrl,
    startShareSession,
    joinShareSession,
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
