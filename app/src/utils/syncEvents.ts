import { db } from '../db/database';
import type { Course, RelaySyncEnvelope, SyncEntityType, SyncEvent, SyncOperationType } from '../models/types';
import { createId } from './idGenerator';

const inferEntityType = (operation: SyncOperationType): SyncEntityType => {
  if (operation.startsWith('course_')) return 'course';
  if (operation.startsWith('student_')) return 'student';
  return 'flight';
};

const ensureCourseSyncId = async (course: Course, deviceId: string): Promise<string> => {
  if (course.syncId) return course.syncId;

  const syncId = createId('course');
  const now = new Date().toISOString();

  if (course.id) {
    await db.courses.update(course.id, {
      syncId,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    });
  }

  return syncId;
};

type LogLocalDeltaInput = {
  courseId: number;
  roomId: string;
  operation: SyncOperationType;
  entitySyncId: string;
  payload: unknown;
  deviceId: string;
};

export const logLocalDeltaEvent = async (input: LogLocalDeltaInput): Promise<SyncEvent> => {
  const course = await db.courses.get(input.courseId);
  if (!course) {
    throw new Error('Kurs nicht gefunden.');
  }

  const courseSyncId = await ensureCourseSyncId(course, input.deviceId);
  const opTs = new Date().toISOString();

  const event: SyncEvent = {
    opId: createId('op'),
    roomId: input.roomId,
    courseSyncId,
    entityType: inferEntityType(input.operation),
    entitySyncId: input.entitySyncId,
    operation: input.operation,
    opTs,
    deviceId: input.deviceId,
    payload: input.payload,
  };

  const id = Number(await db.syncEvents.add(event));
  return { ...event, id };
};

export const ingestRemoteDeltaEvent = async (envelope: RelaySyncEnvelope): Promise<{ accepted: boolean; event: SyncEvent }> => {
  const existing = await db.syncEvents.where('opId').equals(envelope.opId).first();
  if (existing) {
    return { accepted: false, event: existing };
  }

  const event: SyncEvent = {
    opId: envelope.opId,
    roomId: envelope.roomId,
    courseSyncId: envelope.courseSyncId,
    entityType: inferEntityType(envelope.operation),
    entitySyncId: String((envelope.payload as { syncId?: string })?.syncId ?? envelope.courseSyncId),
    operation: envelope.operation,
    opTs: envelope.opTs,
    deviceId: envelope.deviceId,
    payload: envelope.payload,
  };

  const id = Number(await db.syncEvents.add(event));
  return { accepted: true, event: { ...event, id } };
};

export const listCourseDeltaEvents = async (courseSyncId: string): Promise<SyncEvent[]> => {
  const events = await db.syncEvents.where('courseSyncId').equals(courseSyncId).toArray();
  return events.sort((a, b) => {
    const byTime = Date.parse(a.opTs) - Date.parse(b.opTs);
    if (byTime !== 0) return byTime;
    return a.opId.localeCompare(b.opId);
  });
};

export const listRoomDeltaEvents = async (roomId: string): Promise<SyncEvent[]> => {
  const events = await db.syncEvents.where('roomId').equals(roomId).toArray();
  return events.sort((a, b) => {
    const byTime = Date.parse(a.opTs) - Date.parse(b.opTs);
    if (byTime !== 0) return byTime;
    return a.opId.localeCompare(b.opId);
  });
};
