import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { db } from '../db/database';
import { courseSnapshot } from '../test/fixtures';

it('retains local course data and removes V1 sessions and sync events on the V7 upgrade', async () => {
  await db.delete();
  const old = new Dexie('DigiKladdeDB');
  old.version(6).stores({
    courses: '++id, syncId, name, startDate, endDate, flightSchool, updatedAt',
    students: '++id, syncId, name, glider, color, flightSchool, updatedAt',
    flights: '++id, syncId, courseId, studentId, startTime, endTime, landingPendingUntil, landingFinalizedAt, updatedAt',
    syncEvents: '++id, &opId, roomId, courseSyncId, entityType, entitySyncId, opTs, operation, deviceId',
    shareSessions: '++id, courseSyncId, roomId, state, updatedAt, [roomId+courseSyncId]',
  });
  await old.open();
  const snapshot = courseSnapshot();
  const course = { ...snapshot.course, id: 1 };
  const students = course.students.map((student, index) => ({ ...student, id: index + 1 }));
  const flights = snapshot.flights.map((flight, index) => ({ ...flight, id: index + 1, courseId: 1, studentId: 1 }));
  await old.table('courses').add(course);
  await old.table('students').bulkAdd(students);
  await old.table('flights').bulkAdd(flights);
  await old.table('shareSessions').add({
    roomId: 'old-room', courseSyncId: 'course', state: 'connected', lastRelayQueueSeq: 42,
  });
  await old.table('syncEvents').bulkAdd([
    { opId: 'pending', roomId: 'old-room', courseSyncId: 'course', payload: { name: 'Private data' } },
    { opId: 'sent', roomId: 'old-room', courseSyncId: 'course', sentToRelayAt: snapshot.exportedAt },
    { opId: 'orphan', roomId: 'removed-room', courseSyncId: 'removed-course' },
  ]);
  old.close();
  await db.open();
  expect(await db.courses.toArray()).toEqual([course]);
  expect(await db.students.toArray()).toEqual(students);
  expect(await db.flights.toArray()).toEqual(flights);
  expect(await db.shareSessions.count()).toBe(0);
  expect(await db.syncEvents.count()).toBe(0);
  expect(await db.roomKeys.count()).toBe(0);
  expect(await db.receivedMessages.count()).toBe(0);
});
