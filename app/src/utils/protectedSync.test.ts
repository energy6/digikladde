import { expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { courseSnapshot, delta, initialTime, privateCourseSnapshot, syncDatabaseState } from '../test/fixtures';
import { encryptBox, randomSecret } from './e2eCrypto';
import { applyProtectedSync } from './protectedSync';
import { sealRoomMessage } from './roomKeys';
import { exportCourseSnapshot, importCourseSnapshot } from './syncSnapshot';

const setup = async () => {
  await db.roomKeys.add({ roomId: 'room', courseSyncId: 'course', epoch: 'epoch', secret: randomSecret(), sentCount: 0 });
  const snapshot = { ...courseSnapshot(), roomId: 'room' };
  const box = await sealRoomMessage('room', 'remote-device', 'snapshot', snapshot);
  return { snapshot, box };
};

const setupCourses = async () => {
  const { snapshot, box } = await setup();
  const { courseId } = await applyProtectedSync('room', box, 'local', 'remote-device');
  const privateSnapshot = privateCourseSnapshot();
  await importCourseSnapshot(privateSnapshot);
  return { snapshot, courseId, privateSnapshot };
};

it('imports snapshots and deltas atomically, and suppresses replays after reopening the DB', async () => {
  const { box } = await setup();
  await applyProtectedSync('room', box, 'local', 'remote-device');
  const event = delta('course_upsert', { syncId: 'course', name: 'Encrypted change', updatedAt: '2026-01-02T10:00:00Z' });
  const update = await sealRoomMessage('room', 'remote-device', 'delta', event, event.opId);
  await applyProtectedSync('room', update, 'local', 'remote-device');
  expect((await db.courses.toArray())[0].name).toBe('Encrypted change');
  db.close();
  await db.open();
  await applyProtectedSync('room', box, 'local', 'remote-device');
  await applyProtectedSync('room', update, 'local', 'remote-device');
  expect(await db.courses.count()).toBe(1);
  expect(await db.receivedMessages.count()).toBe(2);
  expect(await db.syncEvents.count()).toBe(1);
  expect((await db.courses.toArray())[0].name).toBe('Encrypted change');
});

it('rejects forged, wrong-context, plaintext and malformed decrypted content without DB changes', async () => {
  const { snapshot, box } = await setup();
  const key = await db.roomKeys.get('room');
  expect(key).toBeDefined();
  if (!key) throw new Error('Test key missing');
  const malformed = await encryptBox(key.secret, { ...box, messageId: 'bad-content' }, { ...snapshot, course: {} });
  const wrongCourse = await sealRoomMessage('room', 'remote-device', 'snapshot', {
    ...snapshot, course: { ...snapshot.course, syncId: 'different' },
  });
  const wrongPurpose = await sealRoomMessage('room', 'remote-device', 'push', snapshot);
  const wrongDelta = delta('course_upsert', { syncId: 'different', name: 'Wrong course' });
  const wrongBinding = await sealRoomMessage('room', 'remote-device', 'delta', wrongDelta, wrongDelta.opId);
  for (const invalid of [
    snapshot, { ...box, iv: 'AAAAAAAAAAAAAAAA' }, { ...box, epoch: 'other' }, malformed, wrongCourse,
    wrongPurpose, wrongBinding,
  ]) {
    await expect(applyProtectedSync('room', invalid, 'local', 'remote-device')).rejects.toThrow();
    expect(await db.courses.count()).toBe(0);
    expect(await db.syncEvents.count()).toBe(0);
    expect(await db.receivedMessages.count()).toBe(0);
  }
  await expect(applyProtectedSync('room', box, 'local', 'forged-device')).rejects.toThrow();
});

it('rolls back ingested delta and replay state when application fails', async () => {
  await setup();
  const event = delta('student_upsert', { syncId: 'Anna', name: 'Anna', updatedAt: initialTime });
  const box = await sealRoomMessage('room', 'remote-device', 'delta', event, event.opId);
  await expect(applyProtectedSync('room', box, 'local', 'remote-device')).rejects.toThrow();
  expect(await db.syncEvents.count()).toBe(0);
  expect(await db.receivedMessages.count()).toBe(0);
  expect(await db.students.count()).toBe(0);
});

it.each(['flight_upsert', 'flight_delete'] as const)('rejects encrypted cross-course %s before ingestion', async (operation) => {
  const { courseId } = await setupCourses();
  const event = delta(operation, {
    syncId: 'private-flight', updatedAt: '2026-01-01T11:00:00Z',
    ...(operation === 'flight_upsert' ? { remarks: ['Changed'] } : {}),
  });
  const box = await sealRoomMessage('room', 'remote-device', 'delta', event, event.opId);
  const before = await syncDatabaseState();
  const ingest = vi.spyOn(db.syncEvents, 'add');
  const replay = vi.spyOn(db.receivedMessages, 'add');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await expect(applyProtectedSync('room', box, 'local', 'remote-device')).rejects.toThrow('anderen Kurs');
    expect(await syncDatabaseState()).toEqual(before);
  }
  expect(ingest).not.toHaveBeenCalled();
  expect(replay).not.toHaveBeenCalled();
  const exported = await exportCourseSnapshot(courseId);
  expect(exported.flights.map((flight) => flight.syncId)).toEqual(['flight']);
  expect(exported.flights.flatMap((flight) => flight.remarks ?? [])).not.toContain('Private remarks');
  expect(exported.flights.map((flight) => flight.details?.startPlace)).not.toContain('Private start');
});

it('rejects a whole encrypted snapshot with a foreign flight before any writes', async () => {
  const { snapshot, privateSnapshot } = await setupCourses();
  const updatedAt = '2026-01-01T11:00:00Z';
  const incoming = {
    ...snapshot,
    course: {
      ...snapshot.course, name: 'Changed course', updatedAt,
      students: snapshot.course.students.map((student) => ({ ...student, name: `Changed ${student.name}`, updatedAt })),
    },
    flights: [
      { ...snapshot.flights[0], syncId: 'new-flight', startTime: updatedAt, updatedAt },
      { ...privateSnapshot.flights[0], updatedAt, remarks: ['Changed private remarks'] },
    ],
  };
  const box = await sealRoomMessage('room', 'remote-device', 'snapshot', incoming);
  const before = await syncDatabaseState();
  const writes = [
    vi.spyOn(db.courses, 'add'), vi.spyOn(db.courses, 'update'),
    vi.spyOn(db.students, 'add'), vi.spyOn(db.students, 'update'),
    vi.spyOn(db.flights, 'add'), vi.spyOn(db.flights, 'update'), vi.spyOn(db.flights, 'delete'),
    vi.spyOn(db.syncEvents, 'add'), vi.spyOn(db.receivedMessages, 'add'),
  ];
  await expect(applyProtectedSync('room', box, 'local', 'remote-device')).rejects.toThrow('anderen Kurs');
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  expect(await syncDatabaseState()).toEqual(before);
});

it('applies encrypted own-course flight changes idempotently without touching another course', async () => {
  await setupCourses();
  const privateCourse = await db.courses.where('syncId').equals('private-course').first();
  const privateFlight = await db.flights.where('syncId').equals('private-flight').first();
  for (const operation of ['flight_upsert', 'flight_delete'] as const) {
    const event = delta(operation, {
      syncId: 'flight', updatedAt: operation === 'flight_upsert' ? '2026-01-01T11:00:00Z' : '2026-01-01T12:00:00Z',
      ...(operation === 'flight_upsert' ? { remarks: ['Updated'] } : {}),
    });
    const box = await sealRoomMessage('room', 'remote-device', 'delta', event, event.opId);
    await applyProtectedSync('room', box, 'local', 'remote-device');
    await applyProtectedSync('room', box, 'local', 'remote-device');
    const flight = await db.flights.where('syncId').equals('flight').first();
    if (operation === 'flight_upsert') {
      expect(flight?.remarks).toEqual(['Updated']);
    } else {
      expect(flight).toBeUndefined();
    }
  }
  expect(await db.syncEvents.count()).toBe(2);
  expect(await db.receivedMessages.count()).toBe(3);
  expect(await db.courses.where('syncId').equals('private-course').first()).toEqual(privateCourse);
  expect(await db.flights.where('syncId').equals('private-flight').first()).toEqual(privateFlight);
});
