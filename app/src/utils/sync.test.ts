import { expect, it } from 'vitest';
import { db } from '../db/database';
import { courseSnapshot, delta, initialTime } from '../test/fixtures';
import { applyRemoteDeltaEnvelope } from './syncApply';
import { exportCourseSnapshot, importCourseSnapshot } from './syncSnapshot';

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
