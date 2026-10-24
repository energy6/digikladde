import { db } from '../db/database';
import { decryptBox, type MessagePurpose } from './e2eCrypto';
import { getRoomKey, replayId } from './roomKeys';
import { applyRemoteDeltaEnvelope } from './syncApply';
import { ingestRemoteDeltaEvent } from './syncEvents';
import { assertDeltaFlightCourse } from './syncFlightScope';
import { importCourseSnapshot } from './syncSnapshot';
import { isCourseSyncSnapshot, isRelaySyncEnvelope } from './typeGuards';

export const openRoomMessage = async (
  roomId: string, value: unknown, purpose: MessagePurpose | undefined, sender: string,
): ReturnType<typeof decryptBox> => {
  const key = await getRoomKey(roomId);
  return decryptBox(key.secret, value, {
    version: 2, roomId, courseSyncId: key.courseSyncId, epoch: key.epoch, deviceId: sender,
    ...(purpose ? { purpose } : {}),
  });
};

export const applyProtectedSync = async (
  roomId: string, encrypted: unknown, localDeviceId: string, sender: string,
): Promise<{ courseId: number; snapshot: boolean }> => {
  const { box, value } = await openRoomMessage(roomId, encrypted, undefined, sender);
  let apply: () => Promise<unknown>;
  if (box.purpose === 'snapshot' && isCourseSyncSnapshot(value)) {
    if (value.roomId !== roomId || value.course.syncId !== box.courseSyncId) throw new Error('Snapshot-Bindung ungültig.');
    apply = () => importCourseSnapshot(value, localDeviceId);
  } else if (box.purpose === 'delta' && isRelaySyncEnvelope(value)) {
    if (value.roomId !== roomId || value.courseSyncId !== box.courseSyncId
      || value.deviceId !== box.deviceId || value.opId !== box.messageId) throw new Error('Delta-Bindung ungültig.');
    if (value.operation === 'course_upsert' && typeof value.payload === 'object' && value.payload !== null
      && 'syncId' in value.payload && value.payload.syncId !== box.courseSyncId) throw new Error('Kurs-Bindung ungültig.');
    apply = async () => {
      await assertDeltaFlightCourse(value);
      const result = await ingestRemoteDeltaEvent(value);
      if (result.accepted) await applyRemoteDeltaEnvelope(value);
    };
  } else {
    throw new Error('Ungültiger entschlüsselter Sync-Inhalt.');
  }

  return db.transaction('rw', [db.courses, db.students, db.flights, db.syncEvents, db.receivedMessages, db.roomKeys], async () => {
    // Re-check inside the transaction so leaving a room cannot race a pending decrypt.
    await getRoomKey(roomId);
    const id = replayId(box);
    if (!await db.receivedMessages.get(id)) {
      await apply();
      await db.receivedMessages.add({ id, roomId });
    }
    const course = await db.courses.where('syncId').equals(box.courseSyncId).first();
    if (!course?.id) throw new Error('Zielkurs der Sync-Nachricht fehlt.');
    return { courseId: course.id, snapshot: box.purpose === 'snapshot' };
  });
};
