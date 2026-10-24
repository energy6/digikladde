import { expect, it, vi } from 'vitest';
import { db } from '../db/database';
import { courseSnapshot, delta, initialTime, privateCourseSnapshot, syncDatabaseState } from '../test/fixtures';
import { applyRemoteDeltaEnvelope } from './syncApply';
import { exportCourseSnapshot, importCourseSnapshot } from './syncSnapshot';

const setupCourses = async () => {
  const { courseId } = await importCourseSnapshot(courseSnapshot());
  const privateSnapshot = privateCourseSnapshot();
  const { courseId: privateCourseId } = await importCourseSnapshot(privateSnapshot);
  return { courseId, privateCourseId, privateSnapshot };
};

it('roundtrips snapshots using sync IDs with different local student IDs', async () => {
  const snapshot = courseSnapshot();
  const first = await importCourseSnapshot(snapshot);
  const exported = await exportCourseSnapshot(first.courseId);
  expect(exported.course.students.map((student) => student.name)).toEqual(['Anna', 'Ben']);
  expect(exported.flights).toHaveLength(1);
  expect(exported.flights[0]).toMatchObject(snapshot.flights[0]);
  await db.delete();
  await db.open();
  await db.students.add({ ...snapshot.course.students[1], syncId: 'unrelated' });
  const second = await importCourseSnapshot(exported);
  const anna = await db.students.where('syncId').equals('Anna').first();
  const flight = await db.flights.where('courseId').equals(second.courseId).first();
  expect(anna?.id).not.toBe(1);
  expect(flight?.studentId).toBe(anna?.id);
  expect(flight?.ratings).toEqual({ Start: 8, Acht: 7, Landung: 0 });
  expect(flight?.details).toEqual(snapshot.flights[0].details);
  expect(flight?.remarks).toEqual(['Ruhiger Start']);
  await importCourseSnapshot(exported);
  expect(await db.flights.count()).toBe(1);
});

it('applies starts, ratings, landings and finalization idempotently without lifecycle regression', async () => {
  const snapshot = courseSnapshot();
  snapshot.flights = [];
  await importCourseSnapshot(snapshot);
  const apply = async (payload: Record<string, unknown>, updatedAt: string) => {
    await applyRemoteDeltaEnvelope(delta('flight_upsert', {
      syncId: 'flight', studentSyncId: 'Anna', updatedAt, ...payload,
    }, updatedAt));
  };
  await apply({ startTime: initialTime, maneuvers: ['Acht'] }, initialTime);
  await apply({ maneuvers: ['Acht', 'Rollen'], ratings: { Start: 8, Acht: 7, Rollen: 6, Landung: 9 }, remarks: ['Gut'] }, '2026-01-01T10:10:00Z');
  await apply({ landingMarkedAt: '2026-01-01T10:15:00Z', landingPendingUntil: '2026-01-01T10:20:00Z' }, '2026-01-01T10:15:00Z');
  expect((await db.flights.toArray())[0].endTime).toBeUndefined();
  const finalized = { endTime: '2026-01-01T10:15:00Z', landingFinalizedAt: '2026-01-01T10:20:00Z', landingPendingUntil: null };
  await apply(finalized, '2026-01-01T10:20:00Z');
  await apply(finalized, '2026-01-01T10:20:00Z');
  await apply({ maneuvers: ['Acht'] }, '2026-01-01T10:05:00Z');
  await apply({ maneuvers: ['Acht'], endTime: null }, '2026-01-01T10:21:00Z');
  const flights = await db.flights.toArray();
  expect(flights).toHaveLength(1);
  expect(flights[0].landingPendingUntil).toBeUndefined();
  expect(flights[0]).toMatchObject({
    endTime: finalized.endTime, landingFinalizedAt: finalized.landingFinalizedAt,
    maneuvers: ['Acht', 'Rollen'], ratings: { Start: 8, Acht: 7, Rollen: 6, Landung: 9 }, remarks: ['Gut'],
  });
});

it('resolves duplicate starts deterministically and unions their maneuvers', async () => {
  await importCourseSnapshot(courseSnapshot());
  await applyRemoteDeltaEnvelope(delta('flight_upsert', {
    syncId: 'later-flight', studentSyncId: 'Anna', startTime: '2026-01-01T10:00:30Z',
    updatedAt: '2026-01-01T10:01:00Z', maneuvers: ['Rollen'],
  }));
  const flights = await db.flights.toArray();
  expect(flights).toHaveLength(1);
  expect(flights[0].syncId).toBe('flight');
  expect(flights[0].maneuvers).toEqual(['Acht', 'Rollen']);
});

it('keeps embedded and standalone students aligned and ignores stale updates', async () => {
  const { courseId } = await importCourseSnapshot(courseSnapshot());
  const payload = { syncId: 'Anna', totalFlights: 1, totalAltitudeMeters: 850, lastRatings: { Start: 8 }, updatedAt: '2026-01-01T10:20:00Z' };
  await applyRemoteDeltaEnvelope(delta('student_upsert', payload));
  await applyRemoteDeltaEnvelope(delta('student_upsert', { ...payload, totalFlights: 99, updatedAt: initialTime }));
  const anna = await db.students.where('syncId').equals('Anna').first();
  const course = await db.courses.get(courseId);
  expect(anna).toMatchObject({ totalFlights: 1, totalAltitudeMeters: 850 });
  expect(course?.students.find((student) => student.syncId === 'Anna')).toEqual(anna);
});

it('does not resurrect a deleted flight from an older delta or snapshot', async () => {
  const snapshot = courseSnapshot();
  await importCourseSnapshot(snapshot);
  const updatedAt = '2026-01-01T10:20:00Z';
  await db.syncEvents.add({
    opId: 'delete', roomId: 'room', courseSyncId: 'course', entityType: 'flight',
    entitySyncId: 'flight', operation: 'flight_delete', opTs: updatedAt, deviceId: 'remote',
    payload: { syncId: 'flight', updatedAt },
  });
  await applyRemoteDeltaEnvelope(delta('flight_delete', { syncId: 'flight', updatedAt }));
  await applyRemoteDeltaEnvelope(delta('flight_upsert', snapshot.flights[0]));
  await importCourseSnapshot(snapshot);
  expect(await db.flights.count()).toBe(0);
});

it.each([
  { operation: 'flight_upsert', updatedAt: '2026-01-01T11:00:00Z' },
  { operation: 'flight_delete', updatedAt: '2026-01-01T11:00:00Z' },
  { operation: 'flight_upsert', updatedAt: '2025-12-31T10:00:00Z' },
  { operation: 'flight_delete', updatedAt: '2025-12-31T10:00:00Z' },
] as const)('rejects cross-course $operation even with timestamp $updatedAt', async ({ operation, updatedAt }) => {
  const { privateSnapshot } = await setupCourses();
  const before = await syncDatabaseState();
  const payload = { ...privateSnapshot.flights[0], remarks: ['Changed'], updatedAt };
  await expect(applyRemoteDeltaEnvelope(delta(operation, payload))).rejects.toThrow('anderen Kurs');
  expect(await syncDatabaseState()).toEqual(before);
});

it('rejects a foreign flight ID even when an own-course flight has the same sync ID', async () => {
  const { courseId, privateSnapshot } = await setupCourses();
  await db.flights.where('courseId').equals(courseId).modify({ syncId: privateSnapshot.flights[0].syncId });
  const before = await syncDatabaseState();
  await expect(applyRemoteDeltaEnvelope(delta('flight_upsert', {
    syncId: privateSnapshot.flights[0].syncId, remarks: ['Changed'], updatedAt: '2026-01-01T11:00:00Z',
  }))).rejects.toThrow('anderen Kurs');
  expect(await syncDatabaseState()).toEqual(before);
});

it('checks delta flight ownership before applying deletion tombstones', async () => {
  await setupCourses();
  await db.syncEvents.add({
    ...delta('flight_delete', { syncId: 'private-flight', updatedAt: '2026-01-01T12:00:00Z' }),
    entitySyncId: 'private-flight', entityType: 'flight',
  });
  const before = await syncDatabaseState();
  await expect(applyRemoteDeltaEnvelope(delta('flight_upsert', {
    syncId: 'private-flight', studentSyncId: 'unknown', updatedAt: initialTime,
  }))).rejects.toThrow('anderen Kurs');
  expect(await syncDatabaseState()).toEqual(before);
});

it.each([
  { target: 'existing course', missingStudent: false, tombstone: false },
  { target: 'new course', missingStudent: false, tombstone: false },
  { target: 'existing course', missingStudent: true, tombstone: false },
  { target: 'existing course', missingStudent: false, tombstone: true },
])('preflights the entire snapshot for $target (missing student: $missingStudent, tombstone: $tombstone)',
  async ({ target, missingStudent, tombstone }) => {
    const { privateSnapshot } = await setupCourses();
    const snapshot = courseSnapshot();
    const updatedAt = '2026-01-01T11:00:00Z';
    snapshot.course = {
      ...snapshot.course,
      syncId: target === 'new course' ? 'new-course' : snapshot.course.syncId,
      name: 'Changed course',
      updatedAt,
      students: snapshot.course.students.map((student) => ({ ...student, name: `Changed ${student.name}`, updatedAt })),
    };
    snapshot.flights = [
      { ...snapshot.flights[0], syncId: 'new-flight', startTime: updatedAt, updatedAt },
      { ...privateSnapshot.flights[0], updatedAt, studentSyncId: missingStudent ? 'unknown' : 'Anna' },
    ];
    if (tombstone) {
      await db.syncEvents.add({
        ...delta('flight_delete', { syncId: 'private-flight', updatedAt }),
        entitySyncId: 'private-flight', entityType: 'flight',
      });
    }
    const before = await syncDatabaseState();
    const writes = [
      vi.spyOn(db.courses, 'add'), vi.spyOn(db.courses, 'update'),
      vi.spyOn(db.students, 'add'), vi.spyOn(db.students, 'update'),
      vi.spyOn(db.flights, 'add'), vi.spyOn(db.flights, 'update'), vi.spyOn(db.flights, 'delete'),
    ];
    await expect(importCourseSnapshot(snapshot)).rejects.toThrow('anderen Kurs');
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(await syncDatabaseState()).toEqual(before);
  });

it.each(['delta', 'snapshot'] as const)('ignores other-course tombstones when importing a %s', async (mode) => {
  const { privateSnapshot, privateCourseId } = await setupCourses();
  await db.flights.where('courseId').equals(privateCourseId).delete();
  await db.syncEvents.add({
    ...delta('flight_delete', { syncId: 'private-flight', updatedAt: '2026-01-01T11:00:00Z' }),
    entitySyncId: 'private-flight', entityType: 'flight',
  });
  if (mode === 'delta') {
    await applyRemoteDeltaEnvelope({
      ...delta('flight_upsert', privateSnapshot.flights[0]), courseSyncId: privateSnapshot.course.syncId,
    });
  } else {
    await importCourseSnapshot(privateSnapshot);
  }
  const flight = await db.flights.where('courseId').equals(privateCourseId).first();
  expect(flight).toMatchObject({ syncId: 'private-flight', remarks: ['Private remarks'] });
});

it('creates, updates and deletes own-course flights without changing private-course flights', async () => {
  const { privateCourseId } = await setupCourses();
  const privateFlights = await db.flights.where('courseId').equals(privateCourseId).toArray();
  const updatedAt = '2026-01-01T12:00:00Z';
  await applyRemoteDeltaEnvelope(delta('flight_upsert', {
    syncId: 'new-flight', studentSyncId: 'Anna', startTime: updatedAt, updatedAt,
  }));
  expect(await db.flights.where('syncId').equals('new-flight').count()).toBe(1);
  await applyRemoteDeltaEnvelope(delta('flight_upsert', {
    syncId: 'new-flight', remarks: ['Updated'], updatedAt: '2026-01-01T12:01:00Z',
  }));
  expect((await db.flights.where('syncId').equals('new-flight').first())?.remarks).toEqual(['Updated']);
  await applyRemoteDeltaEnvelope(delta('flight_delete', {
    syncId: 'new-flight', updatedAt: '2026-01-01T12:02:00Z',
  }));
  expect(await db.flights.where('syncId').equals('new-flight').count()).toBe(0);
  expect(await db.flights.where('courseId').equals(privateCourseId).toArray()).toEqual(privateFlights);
});

it('allows global student updates while keeping membership changes scoped to the shared course', async () => {
  const { courseId, privateCourseId } = await setupCourses();
  const privateCourse = await db.courses.get(privateCourseId);
  const privateFlights = await db.flights.where('courseId').equals(privateCourseId).toArray();
  await applyRemoteDeltaEnvelope(delta('student_upsert', {
    syncId: 'Anna', name: 'Updated Anna', updatedAt: '2026-01-01T11:00:00Z',
  }));
  expect((await db.students.where('syncId').equals('Anna').first())?.name).toBe('Updated Anna');
  await applyRemoteDeltaEnvelope(delta('student_upsert', {
    ...courseSnapshot().course.students[0], syncId: 'Clara', name: 'Clara',
  }));
  expect((await db.courses.get(courseId))?.students.map((student) => student.syncId)).toContain('Clara');
  await applyRemoteDeltaEnvelope(delta('student_delete', { syncId: 'Anna' }));
  expect((await db.courses.get(courseId))?.students.map((student) => student.syncId)).toEqual(['Ben', 'Clara']);
  expect(await db.students.where('syncId').equals('Anna').count()).toBe(1);
  expect(await db.courses.get(privateCourseId)).toEqual(privateCourse);
  expect(await db.flights.where('courseId').equals(privateCourseId).toArray()).toEqual(privateFlights);
});
